"""Unit tests for AmpersendManagementClient."""

from typing import Any, Dict
from unittest.mock import AsyncMock, patch

import pytest
from ampersend_sdk.ampersend.management import (
    AgentResponse,
    AmpersendManagementClient,
    SpendConfig,
)
from eth_account import Account

# Deterministic test key
TEST_PRIVATE_KEY = "0x" + "ab" * 32
TEST_ACCOUNT = Account.from_key(TEST_PRIVATE_KEY)
TEST_ADDRESS = TEST_ACCOUNT.address

# This fixture is the REAL wire shape the API returns from `/v1/sdk/agents`:
# snake_case outer keys (`user_id`, `init_data`, `created_at`, `updated_at`),
# camelCase inner `init_data` keys, plus extra snake_case fields the API sends
# that the model ignores (`status`, `team_id`, `slug`, ...).
#
# IMPORTANT: a fixture that matches the SDK schema instead of the real wire
# format is exactly how the userId-vs-user_id decode bug survived undetected
# through releases 0.0.11-0.0.28. Keep these fixtures pinned to the wire.
MOCK_AGENT_RESPONSE: Dict[str, Any] = {
    "address": "0x1111111111111111111111111111111111111111",
    "name": "test-agent",
    "user_id": "user-123",
    "team_id": "team-456",
    "slug": "test-agent",
    "status": "deployed",
    "balance": "0",
    "init_data": {
        "address": "0x1111111111111111111111111111111111111111",
        "factory": "0x2222222222222222222222222222222222222222",
        "factoryData": "0xdeadbeef",
        "intentExecutorInstalled": True,
    },
    "nonce": "12345",
    "published": False,
    "created_at": 1700000000000,
    "updated_at": 1700000000000,
}

# What the dual-emit API sends during the compatibility window: BOTH the
# canonical snake_case keys AND the legacy camelCase duplicates. Decoding must
# still succeed (AliasChoices lists snake first; the camelCase duplicates are
# accepted as the second choice / ignored as extras).
MOCK_AGENT_RESPONSE_DUAL_EMIT: Dict[str, Any] = {
    **MOCK_AGENT_RESPONSE,
    "userId": "user-123",
    "initData": {
        "address": "0x1111111111111111111111111111111111111111",
        "factory": "0x2222222222222222222222222222222222222222",
        "factoryData": "0xdeadbeef",
        "intentExecutorInstalled": True,
    },
    "createdAt": 1700000000000,
    "updatedAt": 1700000000000,
}


@pytest.mark.asyncio
class TestAmpersendManagementClient:
    async def test_create_agent(self) -> None:
        """create_agent calls single endpoint with agent_key_address."""
        client = AmpersendManagementClient(api_key="sk_test_123")

        mock_response = AsyncMock()
        mock_response.is_success = True
        mock_response.json = lambda: MOCK_AGENT_RESPONSE

        async def mock_request(**kwargs: object) -> AsyncMock:
            assert kwargs["method"] == "POST"
            assert "/api/v1/sdk/agents" in str(kwargs["url"])
            assert "/prepare" not in str(kwargs["url"])
            json_data = kwargs.get("json", {})
            assert isinstance(json_data, dict)
            assert json_data["agent_key_address"] == TEST_ADDRESS
            assert json_data["name"] == "test-agent"
            assert json_data["spend_config"] is None
            assert json_data["authorized_sellers"] is None
            return mock_response

        with patch.object(client.http_client, "request", side_effect=mock_request):
            result = await client.create_agent(
                name="test-agent",
                private_key=TEST_PRIVATE_KEY,
            )

        assert result.address == MOCK_AGENT_RESPONSE["address"]
        assert result.name == "test-agent"
        # snake_case wire keys decode into the snake_case model fields.
        assert result.user_id == "user-123"
        assert result.created_at == 1700000000000
        assert result.updated_at == 1700000000000
        assert result.init_data.factory == (
            "0x2222222222222222222222222222222222222222"
        )
        assert result.init_data.intent_executor_installed is True

    async def test_agent_response_decodes_wire_shape(self) -> None:
        """AgentResponse validates the real snake_case wire payload."""
        agent = AgentResponse(**MOCK_AGENT_RESPONSE)
        assert agent.user_id == "user-123"
        assert agent.init_data.factory_data == "0xdeadbeef"
        assert agent.init_data.intent_executor_installed is True
        assert agent.created_at == 1700000000000

    async def test_agent_response_decodes_dual_emit(self) -> None:
        """AgentResponse validates the dual-emit payload (snake + camel)."""
        agent = AgentResponse(**MOCK_AGENT_RESPONSE_DUAL_EMIT)
        assert agent.user_id == "user-123"
        assert agent.init_data.factory_data == "0xdeadbeef"
        assert agent.created_at == 1700000000000
        assert agent.updated_at == 1700000000000

    async def test_agent_response_decodes_legacy_camel_only(self) -> None:
        """Back-compat: a pure camelCase payload still validates via AliasChoices."""
        camel_only: Dict[str, Any] = {
            "address": "0x1111111111111111111111111111111111111111",
            "name": "test-agent",
            "userId": "user-123",
            "balance": "0",
            "initData": {"factoryData": "0xdeadbeef"},
            "nonce": "12345",
            "createdAt": 1700000000000,
            "updatedAt": 1700000000000,
        }
        agent = AgentResponse(**camel_only)
        assert agent.user_id == "user-123"
        assert agent.init_data.factory_data == "0xdeadbeef"
        assert agent.created_at == 1700000000000

    async def test_create_agent_with_spend_config(self) -> None:
        """Spend config and authorized sellers are passed through."""
        client = AmpersendManagementClient(api_key="sk_test_123")

        mock_response = AsyncMock()
        mock_response.is_success = True
        mock_response.json = lambda: MOCK_AGENT_RESPONSE

        submitted_payload: dict[str, object] = {}

        async def mock_request(**kwargs: object) -> AsyncMock:
            nonlocal submitted_payload
            json_data = kwargs.get("json", {})
            assert isinstance(json_data, dict)
            submitted_payload = json_data
            return mock_response

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
        assert submitted_payload["agent_key_address"] == TEST_ADDRESS
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
        client = AmpersendManagementClient(api_key="sk_test_123")

        # API returns paginated response. Mix a plain wire item with a dual-emit
        # item so the list path is exercised against both shapes.
        paginated_response = {
            "items": [
                MOCK_AGENT_RESPONSE,
                {**MOCK_AGENT_RESPONSE_DUAL_EMIT, "name": "agent-2"},
            ],
            "total": 2,
            "limit": 50,
            "offset": 0,
        }

        mock_response = AsyncMock()
        mock_response.is_success = True
        mock_response.json = lambda: paginated_response

        async def mock_request(**kwargs: object) -> AsyncMock:
            assert kwargs["method"] == "GET"
            assert "/api/v1/sdk/agents" in str(kwargs["url"])
            headers = kwargs.get("headers", {})
            assert isinstance(headers, dict)
            assert headers["Authorization"] == "Bearer sk_test_123"
            return mock_response

        with patch.object(client.http_client, "request", side_effect=mock_request):
            result = await client.list_agents()

        assert len(result) == 2
        assert result[0].name == "test-agent"
        assert result[0].user_id == "user-123"
        assert result[1].name == "agent-2"
        assert result[1].user_id == "user-123"

    async def test_context_manager(self) -> None:
        """Async context manager opens and closes the HTTP client."""
        async with AmpersendManagementClient(api_key="sk_test") as client:
            assert client._http_client is not None
        # After exiting, the client should be closed
        assert client._http_client is None
