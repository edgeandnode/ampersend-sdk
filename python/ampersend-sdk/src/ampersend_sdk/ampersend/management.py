"""Agent management client using API key authentication."""

from types import TracebackType
from typing import Any, Dict, List, Optional, Self

import httpx
from eth_abi.abi import encode
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils.crypto import keccak
from pydantic import BaseModel, ConfigDict, Field

from .types import ApiError

DEFAULT_API_URL = "https://api.ampersend.ai"
DEFAULT_CHAIN_ID = 84532  # Base Sepolia

# ERC-4337 EntryPoint v0.7 address (same on all chains)
ENTRYPOINT_V07_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"


class SpendConfig(BaseModel):
    """Spend limits for an agent."""

    auto_topup_allowed: bool = False
    daily_limit: Optional[int] = None
    monthly_limit: Optional[int] = None
    per_transaction_limit: Optional[int] = None

    def to_api_dict(self) -> Dict[str, Any]:
        """Serialize for API (converts limits to strings)."""
        return {
            "auto_topup_allowed": self.auto_topup_allowed,
            "daily_limit": (
                str(self.daily_limit) if self.daily_limit is not None else None
            ),
            "monthly_limit": (
                str(self.monthly_limit) if self.monthly_limit is not None else None
            ),
            "per_transaction_limit": (
                str(self.per_transaction_limit)
                if self.per_transaction_limit is not None
                else None
            ),
        }


class AgentInitData(BaseModel):
    """Agent initialization data returned from the API."""

    address: Optional[str] = None
    factory: Optional[str] = None
    factory_data: Optional[str] = Field(default=None, validation_alias="factoryData")
    intent_executor_installed: Optional[bool] = Field(
        default=None, validation_alias="intentExecutorInstalled"
    )

    model_config = ConfigDict(validate_by_name=True)


class AgentResponse(BaseModel):
    """Agent record returned from the API."""

    address: str
    name: str
    user_id: str = Field(validation_alias="userId")
    balance: str
    init_data: AgentInitData = Field(validation_alias="initData")
    nonce: str
    created_at: int = Field(validation_alias="createdAt")
    updated_at: int = Field(validation_alias="updatedAt")

    model_config = ConfigDict(validate_by_name=True)


class AmpersendManagementClient:
    """Client for managing agents via API key authentication.

    Usage::

        async with AmpersendManagementClient(api_key="amp_...") as client:
            agent = await client.create_agent(
                name="my-agent",
                private_key="0x...",
            )
    """

    def __init__(
        self,
        api_key: str,
        api_url: str = DEFAULT_API_URL,
        timeout: float = 30,
        chain_id: int = DEFAULT_CHAIN_ID,
    ) -> None:
        self._api_key = api_key
        self._base_url = api_url.rstrip("/")
        self._timeout = timeout
        self._chain_id = chain_id
        self._http_client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self) -> Self:
        self._http_client = httpx.AsyncClient(timeout=self._timeout)
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        await self.close()

    @property
    def http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=self._timeout)
        return self._http_client

    async def create_agent(
        self,
        *,
        name: str,
        private_key: str,
        spend_config: Optional[SpendConfig] = None,
        authorized_sellers: Optional[List[str]] = None,
    ) -> AgentResponse:
        """Create and deploy a new agent on-chain.

        Handles the full prepare -> sign -> submit flow. The private key is used
        only locally to derive the address and sign the deployment UserOp; it is
        never sent to the server.

        Verifies the server response before signing to prevent malicious operations.

        Args:
            name: Human-readable agent name.
            private_key: Agent owner private key (hex, 0x-prefixed).
            spend_config: Optional spending limits.
            authorized_sellers: Optional list of allowed seller addresses.

        Returns:
            Agent record from the API.
        """
        account = Account.from_key(private_key)
        agent_key_address = account.address

        # 1. Prepare unsigned UserOp (POST with JSON body)
        prepare_response = await self._fetch(
            "POST",
            "/api/v1/sdk/agents/prepare",
            json_data={"agent_key_address": agent_key_address},
        )

        # 2. Verify the response before signing (Layer 1: basic sanity checks)
        self._verify_prepare_response(prepare_response, agent_key_address)

        # 3. Sign the UserOp hash
        user_op_hash: str = prepare_response["user_op_hash"]
        hash_bytes = bytes.fromhex(user_op_hash.removeprefix("0x"))
        signed = account.sign_message(encode_defunct(primitive=hash_bytes))
        signature = "0x" + signed.signature.hex()

        # 4. Build create payload (token-based, not full prepare_response)
        payload = {
            "token": prepare_response["token"],
            "signature": signature,
            "name": name,
            "spend_config": spend_config.to_api_dict() if spend_config else None,
            "authorized_sellers": authorized_sellers,
        }

        # 5. Submit signed deployment
        response = await self._fetch("POST", "/api/v1/sdk/agents", json_data=payload)
        return AgentResponse(**response)

    def _verify_prepare_response(
        self, response: Dict[str, Any], agent_key_address: str
    ) -> None:
        """Verify the prepare response before signing.

        Layer 1: Basic sanity checks to prevent signing malicious operations.
        Layer 2: Hash verification to ensure we sign what we expect.
        """
        user_op = response.get("unsigned_user_op", {})

        # Layer 1, Check 1: This is a deployment (factory must be set)
        if user_op.get("factory") is None:
            raise ApiError(
                "Invalid prepare response: not a deployment operation (factory is null)"
            )

        # Layer 1, Check 2: Deploying the expected address
        sender = user_op.get("sender")
        agent_address = response.get("agent_address", "")
        if not sender or sender.lower() != agent_address.lower():
            raise ApiError(
                f"Invalid prepare response: sender mismatch "
                f"(expected {agent_address}, got {sender})"
            )

        # Layer 1, Check 3: Our key is in the owners list
        owners = response.get("owners", [])
        owner_addresses = [o.lower() for o in owners]
        if agent_key_address.lower() not in owner_addresses:
            raise ApiError(
                f"Invalid prepare response: agent key {agent_key_address} "
                f"not in owners list"
            )

        # Layer 2: Verify hash matches the UserOp we're signing
        computed_hash = self._compute_user_op_hash(user_op)
        server_hash = response.get("user_op_hash", "")
        if computed_hash.lower() != server_hash.lower():
            raise ApiError(
                f"Invalid prepare response: hash mismatch "
                f"(computed {computed_hash}, server provided {server_hash})"
            )

    def _compute_user_op_hash(self, user_op: Dict[str, Any]) -> str:
        """Compute ERC-4337 v0.7 UserOperation hash.

        Reference: https://eips.ethereum.org/EIPS/eip-4337
        """

        def to_bytes(hex_str: Optional[str]) -> bytes:
            if not hex_str:
                return b""
            return bytes.fromhex(hex_str.removeprefix("0x"))

        def to_int(value: Any) -> int:
            if isinstance(value, int):
                return value
            if isinstance(value, str):
                return int(value, 16) if value.startswith("0x") else int(value)
            return 0

        def to_address(addr: Optional[str]) -> bytes:
            if not addr:
                return b"\x00" * 20
            return bytes.fromhex(addr.removeprefix("0x").zfill(40))

        # Extract fields
        sender = to_address(user_op.get("sender"))
        nonce = to_int(user_op.get("nonce", 0))
        factory = user_op.get("factory")
        factory_data = user_op.get("factoryData", "0x")
        call_data = to_bytes(user_op.get("callData", "0x"))
        call_gas_limit = to_int(user_op.get("callGasLimit", 0))
        verification_gas_limit = to_int(user_op.get("verificationGasLimit", 0))
        pre_verification_gas = to_int(user_op.get("preVerificationGas", 0))
        max_fee_per_gas = to_int(user_op.get("maxFeePerGas", 0))
        max_priority_fee_per_gas = to_int(user_op.get("maxPriorityFeePerGas", 0))
        paymaster = user_op.get("paymaster")
        paymaster_verification_gas_limit = to_int(
            user_op.get("paymasterVerificationGasLimit", 0)
        )
        paymaster_post_op_gas_limit = to_int(user_op.get("paymasterPostOpGasLimit", 0))
        paymaster_data = to_bytes(user_op.get("paymasterData", "0x"))

        # Build initCode: factory + factoryData (or empty)
        if factory:
            init_code = to_address(factory) + to_bytes(factory_data)
        else:
            init_code = b""

        # Build paymasterAndData: paymaster + gasLimits (16 bytes each) + data
        if paymaster:
            paymaster_and_data = (
                to_address(paymaster)
                + paymaster_verification_gas_limit.to_bytes(16, "big")
                + paymaster_post_op_gas_limit.to_bytes(16, "big")
                + paymaster_data
            )
        else:
            paymaster_and_data = b""

        # Pack gas limits: (verificationGasLimit << 128) | callGasLimit
        account_gas_limits = (verification_gas_limit << 128) | call_gas_limit

        # Pack gas fees: (maxPriorityFeePerGas << 128) | maxFeePerGas
        gas_fees = (max_priority_fee_per_gas << 128) | max_fee_per_gas

        # Encode inner struct (v0.7 format)
        inner_encoded = encode(
            [
                "address",
                "uint256",
                "bytes32",
                "bytes32",
                "bytes32",
                "uint256",
                "bytes32",
                "bytes32",
            ],
            [
                sender,
                nonce,
                keccak(init_code),
                keccak(call_data),
                account_gas_limits.to_bytes(32, "big"),
                pre_verification_gas,
                gas_fees.to_bytes(32, "big"),
                keccak(paymaster_and_data),
            ],
        )

        # Final hash: keccak(keccak(innerEncoded), entryPoint, chainId)
        entrypoint = to_address(ENTRYPOINT_V07_ADDRESS)
        final_encoded = encode(
            ["bytes32", "address", "uint256"],
            [keccak(inner_encoded), entrypoint, self._chain_id],
        )

        return "0x" + keccak(final_encoded).hex()

    async def list_agents(self) -> List[AgentResponse]:
        """List all agents belonging to the authenticated user."""
        result = await self._fetch("GET", "/api/v1/sdk/agents")
        return [AgentResponse(**agent) for agent in result]

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

    async def _fetch(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, str]] = None,
        json_data: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        headers: Dict[str, str] = {
            "Authorization": f"Bearer {self._api_key}",
        }
        if json_data is not None:
            headers["Content-Type"] = "application/json"

        try:
            response = await self.http_client.request(
                method=method,
                url=url,
                params=params,
                json=json_data,
                headers=headers,
            )

            if not response.is_success:
                error_message = f"HTTP {response.status_code} {response.reason_phrase}"
                try:
                    error_body = response.text
                    if error_body:
                        error_message += f": {error_body}"
                except Exception:
                    pass
                raise ApiError(error_message, response.status_code, response)

            return response.json()

        except ApiError:
            raise
        except httpx.TimeoutException:
            raise ApiError(f"Request timeout after {self._timeout}s")
        except Exception as error:
            raise ApiError(f"Request failed: {error}")
