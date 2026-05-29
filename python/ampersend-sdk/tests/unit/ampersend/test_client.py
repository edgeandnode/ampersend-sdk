"""Unit tests for the ApiClient Ampersend-Client header."""

from importlib.metadata import PackageNotFoundError, version
from typing import Any, Dict, Optional
from unittest.mock import AsyncMock, patch

import pytest
from ampersend_sdk.ampersend.client import ApiClient
from ampersend_sdk.ampersend.types import ApiClientOptions
from eth_account import Account

TEST_PRIVATE_KEY = "0x" + "ab" * 32
TEST_ADDRESS = Account.from_key(TEST_PRIVATE_KEY).address


def _expected_version() -> str:
    try:
        return version("ampersend-sdk")
    except PackageNotFoundError:
        return "unknown"


def _make_client(client_name: Optional[str] = None) -> ApiClient:
    return ApiClient(
        ApiClientOptions(
            base_url="https://api.test.invalid",
            session_key_private_key=TEST_PRIVATE_KEY,
            agent_address=TEST_ADDRESS,
            client_name=client_name,
        )
    )


@pytest.mark.asyncio
class TestAmpersendClientHeader:
    async def _captured_headers(self, client: ApiClient) -> Dict[str, str]:
        captured: Dict[str, str] = {}

        mock_response = AsyncMock()
        mock_response.is_success = True
        mock_response.json = lambda: {}

        async def mock_request(**kwargs: Any) -> AsyncMock:
            captured.update(kwargs.get("headers") or {})
            return mock_response

        with patch.object(client.http_client, "request", side_effect=mock_request):
            await client._fetch("/api/v1/agents/auth/nonce")

        return captured

    async def test_defaults_to_sdk_python(self) -> None:
        headers = await self._captured_headers(_make_client())
        assert headers["Ampersend-Client"] == f"sdk-python/{_expected_version()}"

    async def test_uses_caller_supplied_client_name(self) -> None:
        headers = await self._captured_headers(
            _make_client(client_name="ampersend-cli")
        )
        assert headers["Ampersend-Client"] == f"ampersend-cli/{_expected_version()}"
