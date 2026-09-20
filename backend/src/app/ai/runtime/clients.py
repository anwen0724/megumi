"""Request-scoped OpenAI SDK wrappers share HTTP resources owned by Models."""

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
from app.ai.options import CallOptions
from app.ai.runtime.retry import ProviderErrorInfo, provider_error_info, retry_provider_request
from app.ai.stream import ResponseWriter


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
            "Accept": "application/json",
            "Content-Type": "application/json",
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

    async def open_stream(
        self,
        path: str,
        payload: dict[str, JSONValue],
        *,
        model: Model,
        auth: ResolvedAuth,
        options: CallOptions,
        writer: ResponseWriter,
    ) -> AsyncStream[dict[str, object]]:
        """Create an SSE stream; business event interpretation belongs to the adapter."""
        writer.protect([auth.key or "", auth.headers.get("authorization", "")])
        http = options.http_client
        if http is None:
            if self._owned is None:
                self._owned = DefaultAsyncHttpxClient()
            http = self._owned
        client = _RequestClient(auth, http)

        async def request() -> AsyncStream[dict[str, object]]:
            stream = await client.post(
                path,
                body=payload,
                cast_to=dict[str, object],
                stream=True,
                stream_cls=AsyncStream[dict[str, object]],
                options={"timeout": options.timeout_ms / 1000}
                if options.timeout_ms is not None
                else {},
            )
            writer.add_cleanup(stream.close)
            return stream

        return await retry_provider_request(
            request,
            max_retries=options.max_retries,
            max_retry_delay_ms=options.max_retry_delay_ms,
            signal=options.signal,
            error_info=sdk_error_info,
        )


def sdk_error_info(error: Exception) -> ProviderErrorInfo | None:
    """Read retry evidence from actual SDK errors without serializing their objects."""
    if isinstance(error, APIStatusError):
        return ProviderErrorInfo(error.status_code, error.response.headers)
    if isinstance(error, APIConnectionError):
        return ProviderErrorInfo(None, {})
    return provider_error_info(error)
