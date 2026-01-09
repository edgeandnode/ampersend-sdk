"""
BlockRun AI Integration Example.

This example shows how to use BlockRun AI with Ampersend SDK to add
AI capabilities to your agents. BlockRun provides 30+ AI models including
GPT-4o, Claude, Gemini via x402 micropayments.

Setup:
    pip install ampersend-sdk httpx

Usage:
    export BASE_CHAIN_WALLET_KEY="0x..."
    python blockrun_ai_example.py
"""

import asyncio
import os

from ampersend_sdk.integrations.blockrun import BlockRunAI
from ampersend_sdk.x402.treasurers.naive import NaiveTreasurer
from ampersend_sdk.x402.wallets.account import AccountWallet


async def main():
    # Setup wallet with your private key
    private_key = os.environ.get("BASE_CHAIN_WALLET_KEY")
    if not private_key:
        print("Please set BASE_CHAIN_WALLET_KEY environment variable")
        return

    # Create wallet and treasurer
    wallet = AccountWallet(private_key=private_key)
    treasurer = NaiveTreasurer(wallet)

    print(f"Wallet address: {wallet.address}")

    # Create BlockRun AI client
    async with BlockRunAI(treasurer=treasurer) as ai:
        # Simple chat with GPT-4o
        print("\n--- GPT-4o ---")
        response = await ai.chat("gpt-4o", "What is the capital of France?")
        print(f"Response: {response}")

        # Chat with Claude
        print("\n--- Claude Sonnet ---")
        response = await ai.chat(
            "claude-sonnet",
            "Explain x402 payments in one sentence.",
        )
        print(f"Response: {response}")

        # Chat with system prompt
        print("\n--- GPT-4o with system prompt ---")
        response = await ai.chat(
            "gpt-4o",
            "What should I invest in?",
            system="You are a helpful AI assistant. Keep responses brief.",
        )
        print(f"Response: {response}")

        # List available models
        print("\n--- Available Models ---")
        models = await ai.list_models()
        for model in models[:5]:  # Show first 5
            print(f"  - {model.get('id')}: {model.get('pricing', {})}")

    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
