"""X402 Remote Agent Toolset for ADK.

Provides tools for local ADK agents to interact with remote A2A agents
with automatic x402 payment handling.
"""

import uuid
from typing import Any, Optional

import httpx
from a2a.client import A2ACardResolver, ClientConfig
from a2a.types import (
    AgentCard,
    JSONRPCErrorResponse,
    Message,
    Part,
    Role,
    Task,
    TaskState,
    TextPart,
)
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.base_toolset import BaseToolset
from google.adk.tools.function_tool import FunctionTool
from google.adk.tools.tool_context import ToolContext

from ...x402.treasurer import X402Treasurer
from .x402_client_composed import X402ClientComposed
from .x402_client_factory import X402ClientFactory


class X402RemoteAgentToolset(BaseToolset):
    """Toolset for interacting with remote A2A agents via x402.

    Provides tools to list and send messages to remote A2A agents with automatic
    payment handling and per-agent conversation context management.

    The toolset discovers remote agents on initialization and exposes them as
    ADK tools that can be used by a local orchestrator agent.

    Example:
        ```python
        from ampersend_sdk.a2a.client import X402RemoteAgentToolset
        from ampersend_sdk.x402.treasurers import NaiveTreasurer
        from ampersend_sdk.x402.wallets.account import AccountWallet
        from google.adk import Agent

        # Setup
        wallet = AccountWallet(private_key="0x...")
        treasurer = NaiveTreasurer(wallet=wallet)

        toolset = X402RemoteAgentToolset(
            remote_agent_urls=["https://subgraph-a2a.x402.staging.thegraph.com"],
            treasurer=treasurer
        )

        # Create orchestrator agent
        agent = Agent(
            name="orchestrator",
            model="gemini-2.0-flash",
            tools=[toolset],
            before_agent_callback=toolset.get_before_agent_callback()
        )
        ```

    Attributes:
        remote_agent_urls: List of remote agent base URLs to connect to.
        treasurer: X402Treasurer instance for payment authorization.
        state_key_prefix: Key prefix for storing agent contexts in ADK state.
        httpx_client: HTTP client for making requests (optional).
    """

    def __init__(
        self,
        remote_agent_urls: list[str],
        treasurer: X402Treasurer,
        *,
        state_key_prefix: str = "x402_agent_contexts",
        httpx_client: Optional[httpx.AsyncClient] = None,
        **kwargs: Any,
    ):
        """Initialize the remote agent toolset.

        Args:
            remote_agent_urls: List of remote agent base URLs to connect to.
            treasurer: X402Treasurer for payment authorization.
            state_key_prefix: Key prefix for storing agent contexts in ADK state.
                Defaults to "x402_agent_contexts".
            httpx_client: Optional HTTP client. If not provided, creates a default
                client with 30 second timeout.
            **kwargs: Additional arguments passed to BaseToolset.
        """
        super().__init__(**kwargs)

        self.remote_agent_urls = remote_agent_urls
        self.treasurer = treasurer
        self.state_key_prefix = state_key_prefix
        self.httpx_client = httpx_client or httpx.AsyncClient(timeout=30)

        # Will be populated in before_agent_callback
        self._remote_clients: dict[str, X402ClientComposed] = {}
        self._agent_cards: dict[str, AgentCard] = {}
        self._initialized = False

        # Create client factory for creating X402 clients
        self._client_factory = X402ClientFactory(
            treasurer=self.treasurer, config=ClientConfig()
        )

    def get_before_agent_callback(
        self,
    ) -> Any:
        """Get the before_agent_callback for Agent initialization.

        Returns:
            Async callback function that discovers remote agents.
        """
        return self._before_agent_callback

    async def _before_agent_callback(self, callback_context: CallbackContext) -> None:
        """Discover remote agents before agent execution.

        This callback is called by ADK before the agent starts processing.
        It discovers all remote agents and creates X402 clients for them.

        Args:
            callback_context: ADK callback context (not used, required by interface).
        """
        if self._initialized:
            return

        for url in self.remote_agent_urls:
            # Resolve agent card
            card = await A2ACardResolver(self.httpx_client, url).get_agent_card()

            # Create X402 client for this agent
            client = self._client_factory.create(card=card)

            # X402ClientFactory returns X402ClientComposed
            if not isinstance(client, X402ClientComposed):
                raise TypeError(f"Expected X402ClientComposed, got {type(client)}")

            # Store client and card
            self._remote_clients[card.name] = client
            self._agent_cards[card.name] = card

        self._initialized = True

    async def get_tools(
        self, readonly_context: Optional[ReadonlyContext] = None
    ) -> list[BaseTool]:
        """Get the list of tools provided by this toolset.

        Args:
            readonly_context: Optional context for filtering tools (not used).

        Returns:
            List of BaseTool instances wrapped with FunctionTool.
        """
        return [
            FunctionTool(func=self.x402_a2a_list_agents),
            FunctionTool(func=self.x402_a2a_send_to_agent),
        ]

    def x402_a2a_list_agents(self) -> list[dict[str, str]]:
        """List available remote agents.

        Returns a list of remote agents that this toolset can communicate with,
        including their names and descriptions.

        Returns:
            List of dicts with 'name' and 'description' keys for each agent.

        Example:
            ```python
            [
                {
                    "name": "subgraph_agent",
                    "description": "Agent for querying blockchain data via The Graph"
                }
            ]
            ```
        """
        return [
            {"name": card.name, "description": card.description}
            for card in self._agent_cards.values()
        ]

    async def x402_a2a_send_to_agent(
        self, agent_name: str, message: str, tool_context: ToolContext
    ) -> str:
        """Send a message to a specific remote agent.

        Sends a message to the named remote agent and returns the response.
        Payments are handled automatically by the x402 middleware.
        Conversation context is maintained per-agent in ADK state.

        Args:
            agent_name: Name of the remote agent to contact (from list_agents).
            message: Message text to send to the agent.
            tool_context: ADK tool context (auto-injected, provides state access).

        Returns:
            Response text from the remote agent.

        Raises:
            ValueError: If agent_name is not found in available agents.

        Example:
            To use this tool, the LLM would call:
            ```
            send_to_agent(
                agent_name="subgraph_agent",
                message="Query Uniswap V3 pools on Base"
            )
            ```
        """
        # Validate agent exists
        if agent_name not in self._remote_clients:
            available = ", ".join(self._agent_cards.keys())
            raise ValueError(
                f"Agent '{agent_name}' not found. Available agents: {available}"
            )

        client = self._remote_clients[agent_name]

        # Get conversation context for this agent from ADK state
        context_id = self._get_context_id(agent_name, tool_context)

        # Construct A2A message
        request = Message(
            message_id=str(uuid.uuid4()),
            role=Role.user,
            parts=[Part(root=TextPart(text=message))],
            context_id=context_id,
        )

        # Send message - x402 middleware handles payments automatically
        # Response is AsyncIterator[ClientEvent | Message]
        final_response = None
        async for response in client.send_message(request):
            # Buffer streaming responses, keep final result
            final_response = response

        if final_response is None:
            raise RuntimeError(f"No response received from agent '{agent_name}'")

        # Handle errors
        if isinstance(final_response, JSONRPCErrorResponse):
            error = final_response.error
            raise RuntimeError(
                f"Agent '{agent_name}' returned error: {error.message} "
                f"(Code: {error.code})"
            )

        # Extract response based on type
        if isinstance(final_response, Message):
            # Direct message response
            response_text = self._extract_text_from_message(final_response)
            # Messages don't have context_id, so we don't update it
        else:
            # Task response (tuple of Task and optional event)
            task, _ = final_response
            response_text = self._extract_text_from_task(task)

            # Update context for next message
            if task.context_id:
                self._update_context_id(agent_name, task.context_id, tool_context)

        return response_text

    def _get_context_id(
        self, agent_name: str, tool_context: ToolContext
    ) -> Optional[str]:
        """Get conversation context ID for an agent from ADK state.

        Args:
            agent_name: Name of the agent.
            tool_context: ADK tool context with state access.

        Returns:
            Context ID for this agent, or None if no prior conversation.
        """
        contexts: dict[str, Any] = tool_context.state.get(self.state_key_prefix, {})
        context_id: Optional[str] = contexts.get(agent_name)
        return context_id

    def _update_context_id(
        self, agent_name: str, context_id: str, tool_context: ToolContext
    ) -> None:
        """Update conversation context ID for an agent in ADK state.

        Args:
            agent_name: Name of the agent.
            context_id: New context ID to store.
            tool_context: ADK tool context with state access.
        """
        contexts = tool_context.state.setdefault(self.state_key_prefix, {})
        contexts[agent_name] = context_id
        tool_context.state[self.state_key_prefix] = contexts

    def _extract_text_from_message(self, message: Message) -> str:
        """Extract text from a Message response.

        Args:
            message: A2A Message object.

        Returns:
            Concatenated text from all TextPart parts.
        """
        text_parts = []
        for part in message.parts:
            if isinstance(part.root, TextPart):
                text_parts.append(part.root.text)
        return " ".join(text_parts) if text_parts else ""

    def _extract_text_from_task(self, task: Task) -> str:
        """Extract text from a Task response.

        Args:
            task: A2A Task object.

        Returns:
            Concatenated text from task artifacts, or status message.
        """
        if task.status.state in (TaskState.completed, TaskState.failed):
            # Extract text from artifacts
            final_text = []
            if task.artifacts:
                for artifact in task.artifacts:
                    for part in artifact.parts:
                        if isinstance(part.root, TextPart):
                            final_text.append(part.root.text)

            if final_text:
                return " ".join(final_text)

            # Fallback if no text artifacts
            return f"Task {task.status.state.value}"

        # Task still in progress
        return f"Task status: {task.status.state.value}"
