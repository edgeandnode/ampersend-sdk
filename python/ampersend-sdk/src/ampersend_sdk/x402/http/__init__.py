from .factory import create_ampersend_http_client
from .transport import X402HttpTransport

# Note: `require_payment_with_compliance` lives in
# `ampersend_sdk.x402.http.fastapi` and must be imported explicitly:
#
#     from ampersend_sdk.x402.http.fastapi import require_payment_with_compliance
#
# We deliberately do NOT auto-import it here. Loading `fastapi.py` at
# package-init time creates a circular import via the chain
# `ampersend_sdk.x402.__init__ → ampersend_sdk.ampersend.treasurer →
# ampersend_sdk.x402.__init__`. Lazy / explicit import is also the
# right shape for an "extras" surface — buyer-side users who never
# host a paid HTTP API don't pay the fastapi import cost.
__all__ = ["X402HttpTransport", "create_ampersend_http_client"]
