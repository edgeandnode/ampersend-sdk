"""Tests for BlockRun AI integration."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import json

from ampersend_sdk.integrations.blockrun import (
    BlockRunAI,
    BlockRunAIError,
    ChatResponse,
)


class MockTreasurer:
    """Mock treasurer for testing."""

    async def onPaymentRequired(self, payment_required, context=None):
        """Mock payment authorization."""
        from ampersend_sdk.x402.treasurer import X402Authorization

        return X402Authorization(
            authorization_id="test-auth-123",
            payment="mock-payment-payload",
        )

    async def onStatus(self, status, authorization, context=None):
        pass


@pytest.fixture
def mock_treasurer():
    return MockTreasurer()


class TestBlockRunAI:
    """Tests for BlockRunAI client."""

    def test_init(self, mock_treasurer):
        """Test client initialization."""
        ai = BlockRunAI(treasurer=mock_treasurer)
        assert ai._api_url == "https://blockrun.ai/api"
        assert ai._timeout == 60.0

    def test_init_custom_url(self, mock_treasurer):
        """Test client with custom API URL."""
        ai = BlockRunAI(
            treasurer=mock_treasurer,
            api_url="https://custom.api.com/",
            timeout=30.0,
        )
        assert ai._api_url == "https://custom.api.com"
        assert ai._timeout == 30.0

    def test_model_aliases(self, mock_treasurer):
        """Test model alias resolution."""
        ai = BlockRunAI(treasurer=mock_treasurer)
        assert ai.MODELS["gpt-4o"] == "openai/gpt-4o"
        assert ai.MODELS["claude-sonnet"] == "anthropic/claude-sonnet-4"
        assert ai.MODELS["gemini-pro"] == "google/gemini-2.5-pro"

    @pytest.mark.asyncio
    async def test_chat_success(self, mock_treasurer):
        """Test successful chat completion."""
        ai = BlockRunAI(treasurer=mock_treasurer)

        # Mock the HTTP response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "test-123",
            "model": "openai/gpt-4o",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hello!"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
                "total_tokens": 15,
            },
        }

        with patch.object(ai._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            response = await ai.chat("gpt-4o", "Hi!")
            assert response == "Hello!"

            # Verify request was made correctly
            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert "/v1/chat/completions" in call_args[0][0]
            assert call_args[1]["json"]["model"] == "openai/gpt-4o"

        await ai.close()

    @pytest.mark.asyncio
    async def test_chat_with_402(self, mock_treasurer):
        """Test chat with 402 payment required."""
        ai = BlockRunAI(treasurer=mock_treasurer)

        # First response: 402
        mock_402_response = MagicMock()
        mock_402_response.status_code = 402
        mock_402_response.headers = {"payment-required": None}
        mock_402_response.json.return_value = {
            "x402Version": 1,
            "accepts": [
                {
                    "scheme": "exact",
                    "network": "base",
                    "maxAmountRequired": "1000",
                    "resource": "https://blockrun.ai/api/v1/chat/completions",
                    "description": "BlockRun AI API",
                    "mimeType": "application/json",
                    "payTo": "0x123...",
                    "maxTimeoutSeconds": 300,
                    "asset": "USDC",
                }
            ],
        }

        # Second response: 200 success
        mock_200_response = MagicMock()
        mock_200_response.status_code = 200
        mock_200_response.json.return_value = {
            "id": "test-123",
            "model": "openai/gpt-4o",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hello after payment!"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }

        with patch.object(ai._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = [mock_402_response, mock_200_response]

            response = await ai.chat("gpt-4o", "Hi!")
            assert response == "Hello after payment!"

            # Should have made 2 requests
            assert mock_post.call_count == 2

            # Second request should have X-PAYMENT header
            second_call = mock_post.call_args_list[1]
            assert "X-PAYMENT" in second_call[1]["headers"]

        await ai.close()

    @pytest.mark.asyncio
    async def test_chat_completion_full(self, mock_treasurer):
        """Test full chat completion response."""
        ai = BlockRunAI(treasurer=mock_treasurer)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "chatcmpl-test",
            "model": "openai/gpt-4o",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Test response"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 20,
                "completion_tokens": 10,
                "total_tokens": 30,
            },
        }

        with patch.object(ai._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await ai.chat_completion(
                "gpt-4o",
                [{"role": "user", "content": "Hello"}],
                max_tokens=100,
                temperature=0.7,
            )

            assert isinstance(result, ChatResponse)
            assert result.id == "chatcmpl-test"
            assert result.model == "openai/gpt-4o"
            assert len(result.choices) == 1
            assert result.choices[0].message.content == "Test response"
            assert result.usage.total_tokens == 30

        await ai.close()

    @pytest.mark.asyncio
    async def test_list_models(self, mock_treasurer):
        """Test listing available models."""
        ai = BlockRunAI(treasurer=mock_treasurer)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [
                {"id": "openai/gpt-4o", "pricing": {"input": 0.01, "output": 0.03}},
                {"id": "anthropic/claude-sonnet-4", "pricing": {"input": 0.02}},
            ]
        }

        with patch.object(ai._client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response

            models = await ai.list_models()
            assert len(models) == 2
            assert models[0]["id"] == "openai/gpt-4o"

        await ai.close()


class TestChatResponse:
    """Tests for ChatResponse dataclass."""

    def test_from_dict(self):
        """Test creating ChatResponse from dict."""
        data = {
            "id": "test-123",
            "model": "gpt-4o",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hello"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 5,
                "completion_tokens": 3,
                "total_tokens": 8,
            },
        }

        response = ChatResponse.from_dict(data)
        assert response.id == "test-123"
        assert response.model == "gpt-4o"
        assert len(response.choices) == 1
        assert response.choices[0].message.content == "Hello"
        assert response.usage.total_tokens == 8

    def test_from_dict_minimal(self):
        """Test creating ChatResponse from minimal dict."""
        data = {
            "choices": [
                {"message": {"role": "assistant", "content": "Hi"}}
            ],
        }

        response = ChatResponse.from_dict(data)
        assert response.id == ""
        assert response.model == ""
        assert response.choices[0].message.content == "Hi"
        assert response.usage.total_tokens == 0
