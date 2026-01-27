"""
Ampersend SDK - Payment capabilities for AI agents.

Quick start (A2A toolset for ADK):
    from ampersend_sdk import create_ampersend_toolset
    from google.adk import Agent

    toolset = create_ampersend_toolset(
        remote_agent_urls=["https://agent.example.com"],
        smart_account_address="0x...",
        session_key_private_key="0x...",
    )

    agent = Agent(
        name="orchestrator",
        model="gemini-2.0-flash",
        tools=[toolset],
        before_agent_callback=toolset.get_before_agent_callback(),
    )

Quick start (treasurer only):
    from ampersend_sdk import create_ampersend_treasurer

    treasurer = create_ampersend_treasurer(
        smart_account_address="0x...",
        session_key_private_key="0x...",
    )
"""

from ampersend_sdk.a2a.client import (
    create_ampersend_client_factory,
    create_ampersend_toolset,
)
from ampersend_sdk.ampersend import (
    AmpersendTreasurer,
    create_ampersend_treasurer,
)

__all__ = [
    # Simplified factories (recommended)
    "create_ampersend_treasurer",
    "create_ampersend_toolset",
    "create_ampersend_client_factory",
    # Classes (for type hints)
    "AmpersendTreasurer",
]
