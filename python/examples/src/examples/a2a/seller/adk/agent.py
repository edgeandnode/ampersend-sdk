import os

from ampersend_sdk.a2a.server import (
    make_x402_before_agent_callback,
)
from ampersend_sdk.a2a.server.to_a2a import to_a2a
from google.adk import Agent
from google.adk.tools import google_search

root_agent = Agent(
    name="facts_agent",
    before_agent_callback=make_x402_before_agent_callback(
        price="$0.001",
        network="base-sepolia",
        pay_to_address=os.environ["EXAMPLES_A2A_SELLER__PAY_TO_ADDRESS"],
    ),
    model="gemini-2.5-flash-lite",
    description=("Agent to give interesting facts."),
    instruction=("You are a helpful agent who can provide interesting facts."),
    tools=[google_search],
)

a2a_app = to_a2a(root_agent, port=int(os.getenv("PORT", "8001")))
