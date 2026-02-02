"""Unit tests for AmpersendManagementClient."""

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

MOCK_PREPARE_RESPONSE = {
    "agent_address": "0x1111111111111111111111111111111111111111",
    "init_data": {
        "address": "0xabc",
        "factory": "0xdef",
        "factoryData": "0x00",
        "intentExecutorInstalled": False,
    },
    "nonce": "12345",
    "recovery_address": "0x2222222222222222222222222222222222222222",
    "owners": [
        "0x2222222222222222222222222222222222222222",
        TEST_ADDRESS,
    ],
    "unsigned_user_op": {"sender": "0xabc", "callGasLimit": "0x1000"},
    "user_op_hash": "0x" + "ff" * 32,
    "expires_at": 9999999999,
    "server_signature": "deadbeef",
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
        """create_agent calls prepare, signs, then submits."""
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
                # prepare call
                assert kwargs["method"] == "GET"
                assert "/agents/prepare" in str(kwargs["url"])
                params = kwargs.get("params", {})
                assert isinstance(params, dict)
                assert params["agent_key_address"] == TEST_ADDRESS
                return mock_response
            else:
                # create call
                assert kwargs["method"] == "POST"
                json_data = kwargs.get("json", {})
                assert isinstance(json_data, dict)
                assert json_data["name"] == "test-agent"
                assert json_data["signature"].startswith("0x")
                assert len(json_data["signature"]) == 132  # 0x + 65 bytes hex
                assert json_data["keys"] == [
                    {"address": TEST_ADDRESS, "permission_id": None}
                ]
                assert json_data["spend_config"] is None
                assert json_data["authorized_sellers"] is None
                return mock_create_response

        with patch.object(client.http_client, "request", side_effect=mock_request):
            result = await client.create_agent(
                name="test-agent",
                private_key=TEST_PRIVATE_KEY,
            )

        assert result["address"] == MOCK_AGENT_RESPONSE["address"]
        assert result["name"] == "test-agent"
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
            if kwargs["method"] == "GET":
                return mock_prepare
            nonlocal submitted_payload
            submitted_payload = kwargs.get("json", {})  # type: ignore[assignment]
            return mock_create

        with patch.object(client.http_client, "request", side_effect=mock_request):
            await client.create_agent(
                name="test-agent",
                private_key=TEST_PRIVATE_KEY,
                spend_config=SpendConfig(
                    daily_limit=1000000, per_transaction_limit=50000
                ),
                authorized_sellers=["0x3333333333333333333333333333333333333333"],
            )

        assert isinstance(submitted_payload, dict)
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
        assert result[0]["name"] == "test-agent"
        assert result[1]["name"] == "agent-2"

    async def test_context_manager(self) -> None:
        """Async context manager opens and closes the HTTP client."""
        async with AmpersendManagementClient(api_key="amp_test") as client:
            assert client._http_client is not None
        # After exiting, the client should be closed
        assert client._http_client is None
