"""
Ampersend SDK Integrations.

BlockRun AI:
    - BlockRunAI: Direct AI client for 30+ models (GPT-4o, Claude, Gemini, etc.)
    - chat: Quick one-line chat function
"""

from .blockrun import BlockRunAI, BlockRunAIError, chat

__all__ = [
    "BlockRunAI",
    "BlockRunAIError",
    "chat",
]
