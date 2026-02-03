"""Agent management client using API key authentication."""

from types import TracebackType
from typing import Any, Dict, List, Optional, Self

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct
from pydantic import BaseModel, ConfigDict, Field

from .types import ApiError

DEFAULT_API_URL = "https://api.ampersend.ai"


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
    ) -> None:
        self._api_key = api_key
        self._base_url = api_url.rstrip("/")
        self._timeout = timeout
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

        # 1. Prepare unsigned UserOp
        prepare_response = await self._fetch(
            "GET",
            "/api/v1/sdk/agents/prepare",
            params={"agent_key_address": agent_key_address},
        )

        # 2. Sign the UserOp hash
        user_op_hash: str = prepare_response["user_op_hash"]
        hash_bytes = bytes.fromhex(user_op_hash.removeprefix("0x"))
        signed = account.sign_message(encode_defunct(primitive=hash_bytes))
        signature = "0x" + signed.signature.hex()

        # 3. Build create payload
        payload = {
            "signature": signature,
            "prepare_response": prepare_response,
            "name": name,
            "keys": [{"address": agent_key_address, "permission_id": None}],
            "spend_config": spend_config.to_api_dict() if spend_config else None,
            "authorized_sellers": authorized_sellers,
        }

        # 4. Submit signed deployment
        response = await self._fetch("POST", "/api/v1/sdk/agents", json_data=payload)
        return AgentResponse(**response)

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
