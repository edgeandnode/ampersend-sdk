"""
BlockRun AI Integration for Ampersend SDK.

Provides AI capabilities (ChatGPT, Claude, Gemini, and 30+ models) via
BlockRun's x402 AI Gateway with automatic payment handling.

Usage:
    ```python
    from ampersend_sdk.integrations.blockrun import BlockRunAI

    async with BlockRunAI(treasurer=treasurer) as ai:
        response = await ai.chat("gpt-4o", "What is 2+2?")
        print(response)  # "4"
    ```

Available Models:
    - OpenAI: gpt-4o, gpt-4o-mini, gpt-4-turbo, o1, o1-mini
    - Anthropic: claude-sonnet, claude-haiku
    - Google: gemini-pro, gemini-flash
    - DeepSeek: deepseek, deepseek-reasoner
    - Meta: llama

Powered by BlockRun.ai - The Discovery Layer for AI Agents
"""

import json
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx
from x402_a2a.types import (
    PaymentRequirements,
    x402PaymentRequiredResponse,
)

from ..x402.treasurer import X402Treasurer

logger = logging.getLogger(__name__)


@dataclass
class ChatMessage:
    """A chat message."""
    role: str
    content: str


@dataclass
class ChatChoice:
    """A single choice in a chat response."""
    index: int
    message: ChatMessage
    finish_reason: str


@dataclass
class ChatUsage:
    """Token usage information."""
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


@dataclass
class ChatResponse:
    """Chat completion response."""
    id: str
    model: str
    choices: List[ChatChoice]
    usage: ChatUsage

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChatResponse":
        """Create from API response dict."""
        choices = [
            ChatChoice(
                index=c.get("index", 0),
                message=ChatMessage(
                    role=c["message"]["role"],
                    content=c["message"]["content"],
                ),
                finish_reason=c.get("finish_reason", "stop"),
            )
            for c in data.get("choices", [])
        ]
        usage_data = data.get("usage", {})
        usage = ChatUsage(
            prompt_tokens=usage_data.get("prompt_tokens", 0),
            completion_tokens=usage_data.get("completion_tokens", 0),
            total_tokens=usage_data.get("total_tokens", 0),
        )
        return cls(
            id=data.get("id", ""),
            model=data.get("model", ""),
            choices=choices,
            usage=usage,
        )


class BlockRunAIError(Exception):
    """BlockRun AI error."""
    pass


class BlockRunAI:
    """
    BlockRun AI Client for Ampersend SDK.

    Provides access to 30+ AI models (GPT-4o, Claude, Gemini, etc.) via
    BlockRun's x402 AI Gateway. Uses Ampersend's Treasurer for payment
    authorization.

    Features:
        - 30+ AI models from OpenAI, Anthropic, Google, DeepSeek, Meta
        - Pay-per-request pricing with x402 micropayments
        - No API keys needed - wallet is your identity
        - Automatic payment handling via Treasurer

    Example:
        ```python
        from ampersend_sdk.integrations.blockrun import BlockRunAI
        from ampersend_sdk.x402.treasurers.naive import NaiveTreasurer
        from ampersend_sdk.x402.wallets.account import AccountWallet

        wallet = AccountWallet(private_key="0x...")
        treasurer = NaiveTreasurer(wallet)

        async with BlockRunAI(treasurer=treasurer) as ai:
            response = await ai.chat("gpt-4o", "Hello!")
            print(response)
        ```
    """

    DEFAULT_API_URL = "https://blockrun.ai/api"
    DEFAULT_MAX_TOKENS = 1024

    # Popular models with aliases for convenience
    MODELS = {
        # OpenAI
        "gpt-4o": "openai/gpt-4o",
        "gpt-4o-mini": "openai/gpt-4o-mini",
        "gpt-4-turbo": "openai/gpt-4-turbo",
        "o1": "openai/o1",
        "o1-mini": "openai/o1-mini",
        # Anthropic
        "claude-sonnet": "anthropic/claude-sonnet-4",
        "claude-haiku": "anthropic/claude-haiku",
        # Google
        "gemini-pro": "google/gemini-2.5-pro",
        "gemini-flash": "google/gemini-2.5-flash",
        # DeepSeek
        "deepseek": "deepseek/deepseek-chat",
        "deepseek-reasoner": "deepseek/deepseek-reasoner",
        # Meta
        "llama": "meta/llama-3.3-70b",
    }

    def __init__(
        self,
        treasurer: X402Treasurer,
        *,
        api_url: Optional[str] = None,
        timeout: float = 60.0,
    ):
        """
        Initialize BlockRun AI client.

        Args:
            treasurer: X402Treasurer for payment authorization
            api_url: API endpoint URL (default: https://blockrun.ai/api)
            timeout: Request timeout in seconds
        """
        self._treasurer = treasurer
        self._api_url = (api_url or self.DEFAULT_API_URL).rstrip("/")
        self._timeout = timeout
        self._client = httpx.AsyncClient(timeout=timeout)

    async def chat(
        self,
        model: str,
        prompt: str,
        *,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> str:
        """
        Simple chat interface.

        Args:
            model: Model ID (e.g., "gpt-4o", "claude-sonnet", "gemini-pro")
            prompt: User message
            system: Optional system prompt
            max_tokens: Max tokens to generate
            temperature: Sampling temperature (0.0-2.0)

        Returns:
            Assistant's response text

        Example:
            response = await ai.chat("gpt-4o", "What is 2+2?")
            print(response)  # "4"
        """
        messages: List[Dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        result = await self.chat_completion(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return result.choices[0].message.content

    async def chat_completion(
        self,
        model: str,
        messages: List[Dict[str, str]],
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None,
    ) -> ChatResponse:
        """
        Full chat completion interface (OpenAI-compatible).

        Args:
            model: Model ID or alias
            messages: List of message dicts with 'role' and 'content'
            max_tokens: Max tokens to generate
            temperature: Sampling temperature
            top_p: Nucleus sampling parameter

        Returns:
            ChatResponse with choices and usage
        """
        # Resolve model alias
        resolved_model = self.MODELS.get(model, model)

        body: Dict[str, Any] = {
            "model": resolved_model,
            "messages": messages,
            "max_tokens": max_tokens or self.DEFAULT_MAX_TOKENS,
        }
        if temperature is not None:
            body["temperature"] = temperature
        if top_p is not None:
            body["top_p"] = top_p

        return await self._request_with_payment("/v1/chat/completions", body)

    async def _request_with_payment(
        self,
        endpoint: str,
        body: Dict[str, Any],
    ) -> ChatResponse:
        """
        Make request with automatic x402 payment handling.

        Flow:
        1. Send initial request
        2. If 402, use Treasurer to authorize payment
        3. Retry with X-Payment header
        """
        url = f"{self._api_url}{endpoint}"

        # First attempt
        response = await self._client.post(
            url,
            json=body,
            headers={"Content-Type": "application/json"},
        )

        # Handle 402 Payment Required
        if response.status_code == 402:
            return await self._handle_payment(url, body, response)

        # Handle other errors
        if response.status_code != 200:
            try:
                error = response.json()
            except Exception:
                error = {"error": response.text}
            raise BlockRunAIError(f"API error {response.status_code}: {error}")

        return ChatResponse.from_dict(response.json())

    async def _handle_payment(
        self,
        url: str,
        body: Dict[str, Any],
        response: httpx.Response,
    ) -> ChatResponse:
        """
        Handle 402 Payment Required response.

        Uses Ampersend Treasurer for payment authorization.
        """
        # Parse payment requirements from header or body
        payment_header = response.headers.get("payment-required")

        if payment_header:
            try:
                payment_data = json.loads(payment_header)
            except json.JSONDecodeError:
                raise BlockRunAIError(
                    "Invalid payment-required header format"
                )
        else:
            # Try body
            try:
                payment_data = response.json()
            except Exception:
                raise BlockRunAIError(
                    "402 response but no payment requirements found"
                )

        # Build x402PaymentRequiredResponse
        accepts = []
        for accept_data in payment_data.get("accepts", []):
            req = PaymentRequirements(
                scheme=accept_data.get("scheme", "exact"),
                network=accept_data.get("network", "base"),
                max_amount_required=accept_data.get("maxAmountRequired", "0"),
                resource=accept_data.get("resource", url),
                description=accept_data.get("description", "BlockRun AI API"),
                mime_type=accept_data.get("mimeType", "application/json"),
                pay_to=accept_data.get("payTo", ""),
                max_timeout_seconds=accept_data.get("maxTimeoutSeconds", 300),
                asset=accept_data.get("asset", ""),
                extra=accept_data.get("extra"),
            )
            accepts.append(req)

        if not accepts:
            raise BlockRunAIError("No payment requirements in 402 response")

        payment_required = x402PaymentRequiredResponse(
            x402Version=payment_data.get("x402Version", 1),
            accepts=accepts,
            error=payment_data.get("error", ""),
        )

        # Ask Treasurer to authorize payment
        authorization = await self._treasurer.onPaymentRequired(
            payment_required,
            context={"url": url, "body": body},
        )

        if authorization is None:
            raise BlockRunAIError("Payment not authorized by treasurer")

        # Retry with payment
        retry_response = await self._client.post(
            url,
            json=body,
            headers={
                "Content-Type": "application/json",
                "X-PAYMENT": authorization.payment,
            },
        )

        if retry_response.status_code == 402:
            raise BlockRunAIError(
                "Payment rejected. Check wallet balance or treasurer policy."
            )

        if retry_response.status_code != 200:
            try:
                error = retry_response.json()
            except Exception:
                error = {"error": retry_response.text}
            raise BlockRunAIError(
                f"API error after payment {retry_response.status_code}: {error}"
            )

        return ChatResponse.from_dict(retry_response.json())

    async def list_models(self) -> List[Dict[str, Any]]:
        """
        List available models with pricing.

        Returns:
            List of model information dicts with id, pricing, etc.
        """
        response = await self._client.get(f"{self._api_url}/v1/models")

        if response.status_code != 200:
            raise BlockRunAIError(f"Failed to list models: {response.status_code}")

        return response.json().get("data", [])

    async def close(self):
        """Close the HTTP client."""
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()


# Convenience function for quick usage
async def chat(
    treasurer: X402Treasurer,
    model: str,
    prompt: str,
    *,
    system: Optional[str] = None,
) -> str:
    """
    Quick chat function without creating a client.

    Example:
        from ampersend_sdk.integrations.blockrun import chat

        response = await chat(treasurer, "gpt-4o", "Hello!")
    """
    async with BlockRunAI(treasurer=treasurer) as ai:
        return await ai.chat(model, prompt, system=system)
