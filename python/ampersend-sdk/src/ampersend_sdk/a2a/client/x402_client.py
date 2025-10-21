from typing import Any, AsyncIterator, override

from a2a.client import ClientCallContext, ClientEvent
from a2a.client.base_client import BaseClient
from a2a.client.client import (
    ClientConfig,
    ClientEvent,
    Consumer,
)
from a2a.client.middleware import ClientCallInterceptor
from a2a.client.transports.base import ClientTransport
from a2a.types import (
    AgentCard,
    Message,
)
from x402_a2a.core.utils import x402Utils

from ...x402.authorizer import X402Authorizer
from .a2a_client_extensions_interceptor import x402_extension_interceptor
from .x402_middleware import x402_middleware


class X402Client(BaseClient):
    def __init__(
        self,
        *,
        authorizer: X402Authorizer,
        card: AgentCard,
        config: ClientConfig,
        transport: ClientTransport,
        consumers: list[Consumer],
        middleware: list[ClientCallInterceptor],
        **kwargs: Any,
    ):
        middleware = middleware or []
        if x402_extension_interceptor not in middleware:
            middleware.append(x402_extension_interceptor)

        super().__init__(
            card=card,
            config=config,
            transport=transport,
            consumers=consumers,
            middleware=middleware,
            **kwargs,
        )
        self.manual_init(authorizer=authorizer)

    def manual_init(self, authorizer: X402Authorizer) -> None:
        self._authorizer = authorizer
        self._x402Utils = x402Utils()

    @override
    async def send_message(
        self,
        request: Message,
        *,
        context: ClientCallContext | None = None,
    ) -> AsyncIterator[ClientEvent | Message]:
        async for i in x402_middleware(
            authorizer=self._authorizer,
            context=context,
            request=request,
            send_message=super().send_message,
            utils=self._x402Utils,
        ):
            yield i
