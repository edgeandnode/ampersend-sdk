// Strip any `AMPERSEND_*` environment variables inherited from the surrounding
// shell before the suite runs. Several are deliberate hard bypasses for the
// CLI — `AMPERSEND_API_URL` (overrides the resolved API URL), `AMPERSEND_CONTEXT`
// (selects the active context), `AMPERSEND_AGENT_*` (agent credentials) — so a
// value leaked from the environment silently changes behavior under test.
//
// This bites when the SDK is checked out inside a host repo whose direnv/devenv
// exports e.g. `AMPERSEND_API_URL=http://localhost:3002`: tests pass in CI (clean
// env) but fail locally (the non-prod URL changes context auto-naming and API
// resolution). Clearing them up front keeps the suite hermetic regardless of
// where it runs. Tests that need a specific value still set it themselves; this
// only removes inherited ones at startup.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("AMPERSEND_")) {
    Reflect.deleteProperty(process.env, key)
  }
}
