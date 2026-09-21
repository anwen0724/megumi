"""Request-scoped OpenAI SDK wrappers share HTTP resources owned by Models."""

from collections.abc import Awaitable, Callable
from copy import deepcopy
from inspect import isawaitable
from typing import TypedDict

import httpx2
from openai import (
    APIConnectionError,
    APIStatusError,
    AsyncOpenAI,
    AsyncStream,
    DefaultAsyncHttpxClient,
    Omit,
)
from openai._models import SecurityOptions

from app.ai.auth.types import ResolvedAuth
from app.ai.messages import JSONValue
from app.ai.model import Model
from app.ai.options import CallOptions, ProviderResponse
from app.ai.runtime.diagnostics import sensitive_header_values
from app.ai.runtime.retry import ProviderErrorInfo, provider_error_info, retry_provider_request
from app.ai.stream import ResponseWriter


class StreamRequestOptions(TypedDict, total=False):
    """Request-scoped SDK controls forwarded by a protocol's create operation."""

    timeout: float
    extra_headers: dict[str, str | Omit]


type StreamRequest[T] = Callable[
    [AsyncOpenAI, dict[str, JSONValue], StreamRequestOptions], Awaitable[AsyncStream[T]]
]


class _RequestClient(AsyncOpenAI):
    """Use only resolved headers, without reapplying SDK process environment defaults."""

    def __init__(self, auth: ResolvedAuth, http: httpx2.AsyncClient) -> None:
        self._resolved_headers = dict(auth.headers)
        super().__init__(
            api_key=auth.key or "header-auth",
            base_url=auth.base_url,
            max_retries=0,
            http_client=http,
        )

    def _auth_headers(self, security: SecurityOptions) -> dict[str, str]:
        return {}

    @property
    def default_headers(self) -> dict[str, str | Omit]:
        return {
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": Omit(),
            **self._resolved_headers,
        }


class ClientRuntime:
    """Lazily own one HTTP client; never close caller-injected clients."""

    def __init__(self) -> None:
        self._owned: httpx2.AsyncClient | None = None

    async def aclose(self) -> None:
        """Release the owned transport after its active responses finish."""
        if self._owned is not None:
            await self._owned.aclose()

    async def open_stream[T](
        self,
        operation: StreamRequest[T],
        payload: dict[str, JSONValue],
        *,
        model: Model,
        auth: ResolvedAuth,
        options: CallOptions,
        writer: ResponseWriter,
    ) -> AsyncStream[T]:
        """Run a protocol SDK operation with shared hooks, retries and response ownership."""
        writer.protect([auth.key or "", *sensitive_header_values(auth.headers)])
        payload = deepcopy(payload)
        if options.on_payload is not None:
            changed = options.on_payload(payload, model)
            replacement = await changed if isawaitable(changed) else changed
            if replacement is not None:
                if not isinstance(replacement, dict):
                    raise TypeError("on_payload must return a dict or None")
                payload = replacement
        # A callback may retain its reference; every retry uses the frozen final payload.
        payload = deepcopy(payload)
        http = options.http_client
        if http is None:
            if self._owned is None:
                self._owned = DefaultAsyncHttpxClient()
            http = self._owned
        client = _RequestClient(auth, http)
        request_options: StreamRequestOptions = {}
        if options.timeout_ms is not None:
            request_options["timeout"] = options.timeout_ms / 1000
        if "authorization" not in auth.headers:
            # SDK requires a request-level omission to honor explicitly removed authorization.
            request_options["extra_headers"] = {"authorization": Omit()}

        async def request() -> AsyncStream[T]:
            stream = await operation(client, payload, request_options)
            writer.add_cleanup(stream.close)
            return stream

        stream = await retry_provider_request(
            request,
            max_retries=options.max_retries,
            max_retry_delay_ms=options.max_retry_delay_ms,
            signal=options.signal,
            error_info=sdk_error_info,
        )
        if options.on_response is not None:
            view = ProviderResponse(
                status=stream.response.status_code, headers=dict(stream.response.headers)
            )
            notified = options.on_response(view, model)
            if isawaitable(notified):
                await notified
        return stream


def sdk_error_info(error: Exception) -> ProviderErrorInfo | None:
    """Read retry evidence from actual SDK errors without serializing their objects."""
    if isinstance(error, APIStatusError):
        return ProviderErrorInfo(error.status_code, error.response.headers)
    if isinstance(error, APIConnectionError):
        return ProviderErrorInfo(None, {})
    return provider_error_info(error)
