import marimo

__generated_with = "0.18.4"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    **PREQUISITE**:

    Get configs and keys from the ampersend dashboard and set them to local environment variables, so this notebook can access them
    - `AMPERSEND_STAGING_SESSION_KEY`
    - `AMPERSEND_STAGING_SMART_ACCOUNT_ADDRESS`
    - `AMPERSEND_STAGING_SESSION_KEY_PK`
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    # Imports
    """)
    return


@app.cell
def _():
    import marimo as mo
    import os
    return mo, os


@app.cell
def _():
    from ampersend_sdk.a2a.client import X402RemoteA2aAgent
    from ampersend_sdk.ampersend import AmpersendTreasurer, ApiClient, ApiClientOptions
    from ampersend_sdk.x402.wallets.smart_account import SmartAccountWallet
    from ampersend_sdk.smart_account import SmartAccountConfig
    return (
        AmpersendTreasurer,
        ApiClient,
        ApiClientOptions,
        SmartAccountConfig,
        SmartAccountWallet,
        X402RemoteA2aAgent,
    )


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    # Configure & instantiate
    """)
    return


@app.cell
def _(os):
    session_key = os.environ.get("AMPERSEND_STAGING_SESSION_KEY")
    smart_account_address = os.environ.get("AMPERSEND_STAGING_SMART_ACCOUNT_ADDRESS")
    session_key_private_key = os.environ.get("AMPERSEND_STAGING_SESSION_KEY_PK")
    return session_key, session_key_private_key, smart_account_address


@app.cell
def _(
    SmartAccountConfig,
    SmartAccountWallet,
    session_key,
    smart_account_address,
):
    # Create Smart Account wallet
    wallet = SmartAccountWallet(
        config=SmartAccountConfig(
            session_key=session_key,  # From staging dashboard
            smart_account_address=smart_account_address,  # From staging dashboard
        )
    )
    return (wallet,)


@app.cell
def _(
    AmpersendTreasurer,
    ApiClient,
    ApiClientOptions,
    session_key_private_key,
    wallet,
):
    # Create Ampersend treasurer (with spend limits & monitoring)
    treasurer = AmpersendTreasurer(
        api_client=ApiClient(
            options=ApiClientOptions(
                base_url="https://api.staging.ampersend.ai",
                session_key_private_key=session_key_private_key
            )
        ),
        wallet=wallet
    )
    return (treasurer,)


@app.cell
def _(X402RemoteA2aAgent, treasurer):
    # Create agent pointing to staging service (testnet, rate-limited)
    agent = X402RemoteA2aAgent(
        treasurer=treasurer,
        name="my_agent",
        agent_card="https://subgraph-a2a.x402.staging.thegraph.com/.well-known/agent-card.json"
    )
    return (agent,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    # Use agent
    (payments handled automatically with spend limits)
    """)
    return


@app.cell
async def _(agent):
    async for result in agent.run_async("Query Uniswap V3 pools on Base Sepolia"):
        print(result)
    return


@app.cell
def _():
    return


if __name__ == "__main__":
    app.run()
