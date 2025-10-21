from typing import Any, AsyncIterator

from a2a.client import ClientCallContext, ClientEvent
from a2a.client.base_client import BaseClient
from a2a.client.transports import JsonRpcTransport, RestTransport
from a2a.types import Message
from x402_a2a.core.utils import x402Utils

from ...x402.authorizer import X402Authorizer
from .a2a_client_extensions_interceptor import x402_extension_interceptor
from .x402_middleware import x402_middleware


class X402ClientComposed:
    def __init__(self, client: BaseClient, authorizer: X402Authorizer):
        if (
            isinstance(client._transport, (JsonRpcTransport, RestTransport))
            and x402_extension_interceptor not in client._transport.interceptors
        ):
            client._transport.interceptors.append(x402_extension_interceptor)

        self._client = client
        self._authorizer = authorizer
        self._x402Utils = x402Utils()

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
            send_message=self._client.send_message,
            utils=self._x402Utils,
        ):
            yield i

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)

    def __dir__(self) -> list[str]:
        return list(set(dir(self.__class__)) | set(dir(self._client)))

    def __instancecheck__(self, instance: Any) -> bool:
        return isinstance(instance, BaseClient)
