"""Ampersend SDK - Payment capabilities for AI agents."""

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
