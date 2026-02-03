"""Unit tests for AmpersendManagementClient."""

from typing import Any, Dict
from unittest.mock import AsyncMock, patch

import pytest
from ampersend_sdk.ampersend.management import (
    AmpersendManagementClient,
    SpendConfig,
)
from eth_account import Account

# Deterministic test key
TEST_PRIVATE_KEY = "0x" + "ab" * 32
TEST_ACCOUNT = Account.from_key(TEST_PRIVATE_KEY)
TEST_ADDRESS = TEST_ACCOUNT.address

# Mock prepare response with valid data for Layer 1 verification
MOCK_PREPARE_RESPONSE: Dict[str, Any] = {
    "token": "test-token-abc123",
    "agent_address": "0x1111111111111111111111111111111111111111",
    "init_data": {
        "address": "0x1111111111111111111111111111111111111111",
        "factory": "0xdef0000000000000000000000000000000000000",
        "factoryData": "0x00",
        "intentExecutorInstalled": False,
    },
    "nonce": "12345",
    "recovery_address": "0x2222222222222222222222222222222222222222",
    "owners": [
        "0x2222222222222222222222222222222222222222",
        TEST_ADDRESS,
    ],
    # UserOp with sender matching agent_address and factory set (Layer 1 requirements)
    "unsigned_user_op": {
        "sender": "0x1111111111111111111111111111111111111111",
        "factory": "0xdef0000000000000000000000000000000000000",
        "factoryData": "0x00",
        "callData": "0x",
        "callGasLimit": "0x1000",
        "verificationGasLimit": "0x1000",
        "preVerificationGas": "0x1000",
        "maxFeePerGas": "0x1000",
        "maxPriorityFeePerGas": "0x1000",
        "nonce": "0x0",
    },
    "user_op_hash": "0x" + "ff" * 32,
    "expires_at": 9999999999,
}

MOCK_AGENT_RESPONSE = {
    "address": "0x1111111111111111111111111111111111111111",
    "name": "test-agent",
    "user_id": "user-123",
    "balance": "0",
    "init_data": {},
    "nonce": "12345",
    "created_at": 1700000000000,
    "updated_at": 1700000000000,
}


@pytest.mark.asyncio
class TestAmpersendManagementClient:
    async def test_create_agent(self) -> None:
        """create_agent calls prepare (POST), signs, then submits with token."""
        client = AmpersendManagementClient(api_key="amp_test123")

        mock_response = AsyncMock()
        mock_response.is_success = True
        mock_response.json = lambda: MOCK_PREPARE_RESPONSE

        mock_create_response = AsyncMock()
        mock_create_response.is_success = True
        mock_create_response.json = lambda: MOCK_AGENT_RESPONSE

        call_count = 0

        async def mock_request(**kwargs: object) -> AsyncMock:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # prepare call - now POST with JSON body
                assert kwargs["method"] == "POST"
                assert "/agents/prepare" in str(kwargs["url"])
                json_data = kwargs.get("json", {})
                assert isinstance(json_data, dict)
                assert json_data["agent_key_address"] == TEST_ADDRESS
                return mock_response
            else:
                # create call
                assert kwargs["method"] == "POST"
                json_data = kwargs.get("json", {})
                assert isinstance(json_data, dict)
                assert json_data["name"] == "test-agent"
                assert json_data["token"] == "test-token-abc123"  # Now uses token
                assert json_data["signature"].startswith("0x")
                assert len(json_data["signature"]) == 132  # 0x + 65 bytes hex
                assert json_data["spend_config"] is None
                assert json_data["authorized_sellers"] is None
                # Should NOT have prepare_response in payload
                assert "prepare_response" not in json_data
                return mock_create_response

        with (
            patch.object(client.http_client, "request", side_effect=mock_request),
            patch.object(client, "_verify_prepare_response"),  # Skip hash verification
        ):
            result = await client.create_agent(
                name="test-agent",
                private_key=TEST_PRIVATE_KEY,
            )

        assert result.address == MOCK_AGENT_RESPONSE["address"]
        assert result.name == "test-agent"
        assert call_count == 2

    async def test_create_agent_with_spend_config(self) -> None:
        """Spend config and authorized sellers are passed through."""
        client = AmpersendManagementClient(api_key="amp_test123")

        mock_prepare = AsyncMock()
        mock_prepare.is_success = True
        mock_prepare.json = lambda: MOCK_PREPARE_RESPONSE

        mock_create = AsyncMock()
        mock_create.is_success = True
        mock_create.json = lambda: MOCK_AGENT_RESPONSE

        submitted_payload: dict[str, object] = {}

        async def mock_request(**kwargs: object) -> AsyncMock:
            json_data = kwargs.get("json", {})
            assert isinstance(json_data, dict)
            # Distinguish prepare (has agent_key_address) from create (has name)
            if "agent_key_address" in json_data:
                return mock_prepare
            nonlocal submitted_payload
            submitted_payload = json_data
            return mock_create

        with (
            patch.object(client.http_client, "request", side_effect=mock_request),
            patch.object(client, "_verify_prepare_response"),
        ):
            await client.create_agent(
                name="test-agent",
                private_key=TEST_PRIVATE_KEY,
                spend_config=SpendConfig(
                    daily_limit=1000000, per_transaction_limit=50000
                ),
                authorized_sellers=["0x3333333333333333333333333333333333333333"],
            )

        assert isinstance(submitted_payload, dict)
        assert submitted_payload["token"] == "test-token-abc123"
        sc = submitted_payload["spend_config"]
        assert isinstance(sc, dict)
        assert sc["daily_limit"] == "1000000"
        assert sc["per_transaction_limit"] == "50000"
        assert sc["monthly_limit"] is None
        assert sc["auto_topup_allowed"] is False
        assert submitted_payload["authorized_sellers"] == [
            "0x3333333333333333333333333333333333333333"
        ]

    async def test_list_agents(self) -> None:
        """list_agents returns a list of agent dicts."""
        client = AmpersendManagementClient(api_key="amp_test123")

        agents_data = [MOCK_AGENT_RESPONSE, {**MOCK_AGENT_RESPONSE, "name": "agent-2"}]

        mock_response = AsyncMock()
        mock_response.is_success = True
        mock_response.json = lambda: agents_data

        async def mock_request(**kwargs: object) -> AsyncMock:
            assert kwargs["method"] == "GET"
            assert "/api/v1/sdk/agents" in str(kwargs["url"])
            headers = kwargs.get("headers", {})
            assert isinstance(headers, dict)
            assert headers["Authorization"] == "Bearer amp_test123"
            return mock_response

        with patch.object(client.http_client, "request", side_effect=mock_request):
            result = await client.list_agents()

        assert len(result) == 2
        assert result[0].name == "test-agent"
        assert result[1].name == "agent-2"

    async def test_context_manager(self) -> None:
        """Async context manager opens and closes the HTTP client."""
        async with AmpersendManagementClient(api_key="amp_test") as client:
            assert client._http_client is not None
        # After exiting, the client should be closed
        assert client._http_client is None


@pytest.mark.asyncio
class TestLayer1Verification:
    """Test Layer 1 verification checks."""

    async def test_rejects_if_factory_is_null(self) -> None:
        """Rejects if factory is null (not a deployment)."""
        client = AmpersendManagementClient(api_key="amp_test123")

        bad_user_op = dict(MOCK_PREPARE_RESPONSE["unsigned_user_op"])
        bad_user_op["factory"] = None
        bad_response = dict(MOCK_PREPARE_RESPONSE)
        bad_response["unsigned_user_op"] = bad_user_op

        mock_resp = AsyncMock()
        mock_resp.is_success = True
        mock_resp.json = lambda: bad_response

        async def mock_request(**kwargs: object) -> AsyncMock:
            return mock_resp

        with patch.object(client.http_client, "request", side_effect=mock_request):
            with pytest.raises(Exception, match="not a deployment operation"):
                await client.create_agent(name="test", private_key=TEST_PRIVATE_KEY)

    async def test_rejects_if_sender_mismatch(self) -> None:
        """Rejects if sender doesn't match agent_address."""
        client = AmpersendManagementClient(api_key="amp_test123")

        bad_user_op = dict(MOCK_PREPARE_RESPONSE["unsigned_user_op"])
        bad_user_op["sender"] = "0x9999999999999999999999999999999999999999"
        bad_response = dict(MOCK_PREPARE_RESPONSE)
        bad_response["unsigned_user_op"] = bad_user_op

        mock_resp = AsyncMock()
        mock_resp.is_success = True
        mock_resp.json = lambda: bad_response

        async def mock_request(**kwargs: object) -> AsyncMock:
            return mock_resp

        with patch.object(client.http_client, "request", side_effect=mock_request):
            with pytest.raises(Exception, match="sender mismatch"):
                await client.create_agent(name="test", private_key=TEST_PRIVATE_KEY)

    async def test_rejects_if_agent_key_not_in_owners(self) -> None:
        """Rejects if agent key not in owners list."""
        client = AmpersendManagementClient(api_key="amp_test123")

        bad_response = {
            **MOCK_PREPARE_RESPONSE,
            "owners": [
                "0x2222222222222222222222222222222222222222"
            ],  # Missing TEST_ADDRESS
        }

        mock_resp = AsyncMock()
        mock_resp.is_success = True
        mock_resp.json = lambda: bad_response

        async def mock_request(**kwargs: object) -> AsyncMock:
            return mock_resp

        with patch.object(client.http_client, "request", side_effect=mock_request):
            with pytest.raises(Exception, match="not in owners list"):
                await client.create_agent(name="test", private_key=TEST_PRIVATE_KEY)
