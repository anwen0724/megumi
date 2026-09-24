"""Provider snapshots and background calls share a Models-owned runtime."""

import asyncio
from collections.abc import Iterable, Mapping
from copy import deepcopy
from dataclasses import replace
from inspect import isawaitable
from typing import Literal

import httpx2

from app.ai.auth.memory import InMemoryCredentialStore
from app.ai.auth.resolve import has_auth_header, merge_headers, resolve_auth, resolve_provider_auth
from app.ai.auth.types import AuthOverride, CredentialStore, ResolvedAuth
from app.ai.catalog import snapshot_provider
from app.ai.errors import ConfigurationError, LifecycleError
from app.ai.messages import AssistantMessage, Context, Transcript
from app.ai.model import Model
from app.ai.options import CallOptions, SimpleOptions, prepare_call_options
from app.ai.provider import Provider, copy_provider
from app.ai.runtime.diagnostics import sensitive_header_values
from app.ai.stream import AssistantResponse, ResponseWriter
from app.ai.transcript import normalize_context


class Models:
    """Own provider definitions, active calls and lazily created HTTP resources."""

    def __init__(
        self,
        providers: Iterable[Provider] = (),
        *,
        credentials: CredentialStore | None = None,
    ) -> None:
        self._state: Literal["open", "closing", "closed"] = "open"
        self._credentials = credentials if credentials is not None else InMemoryCredentialStore()
        self._http_client: httpx2.AsyncClient | None = None
        self._responses: set[AssistantResponse] = set()
        self._cleanup_errors: list[Exception] = []
        self._close_task: asyncio.Task[None] | None = None
        self._providers: dict[str, Provider] = {}
        for provider in providers:
            self.set_provider(provider)

    def stream_simple(
        self, model: Model, context: Context | Transcript, options: SimpleOptions | None = None
    ) -> AssistantResponse:
        """Start background generation from normalized simple call preferences."""
        return self._start(model, context, options, simple=True)

    def stream(
        self, model: Model, context: Context | Transcript, options: CallOptions | None = None
    ) -> AssistantResponse:
        """Start generation with the selected protocol's explicit options."""
        return self._start(model, context, options, simple=False)

    async def complete(
        self, model: Model, context: Context | Transcript, options: CallOptions | None = None
    ) -> AssistantMessage:
        """Await the same execution path as stream, owning the created response."""
        return await self._complete_response(self.stream(model, context, options))

    async def complete_simple(
        self, model: Model, context: Context | Transcript, options: SimpleOptions | None = None
    ) -> AssistantMessage:
        """Await the same execution path as stream_simple."""
        return await self._complete_response(self.stream_simple(model, context, options))

    @staticmethod
    async def _complete_response(response: AssistantResponse) -> AssistantMessage:
        """Cancellation owns this response and must wait for its cleanup before propagating."""
        try:
            return await response.result()
        except asyncio.CancelledError:
            while True:
                try:
                    await response.aclose()
                    break
                except asyncio.CancelledError:
                    continue
                except ExceptionGroup:
                    # Models retains cleanup failures; preserve the caller's cancellation.
                    break
            raise

    def _start(
        self,
        model: Model,
        context: Context | Transcript,
        options: CallOptions | None,
        *,
        simple: bool,
    ) -> AssistantResponse:
        """Capture independent inputs before the background task's first await."""
        if self._state != "open":
            raise LifecycleError("Model call runtime is closed")
        if not isinstance(model, Model) or not isinstance(context, (Context, Transcript)):
            raise TypeError("Expected Model and Context or Transcript")
        provider = self.get_provider(model.provider)
        current = self.get_model(model.provider, model.id)
        transcript = (
            normalize_context(context) if isinstance(context, Context) else deepcopy(context)
        )
        if options is None:
            options = SimpleOptions() if simple else CallOptions()
        if not isinstance(options, SimpleOptions if simple else CallOptions):
            raise TypeError("Options do not match the call entry")
        captured = prepare_call_options(current or model, options)

        async def produce(writer: ResponseWriter) -> None:
            if provider is None or current is None:
                raise ConfigurationError("Model is not registered")
            writer.protect([captured.api_key or "", *sensitive_header_values(captured.headers)])

            removed_headers = {
                name.lower(): None
                for layer in (provider.headers, current.headers, captured.headers)
                for name, value in layer.items()
                if value is None
            }

            async def transform(headers: dict[str, str]) -> Mapping[str, str | None]:
                writer.protect(sensitive_header_values(headers))
                if captured.transform_headers is None:
                    return headers
                changed = captured.transform_headers(headers)
                result = await changed if isawaitable(changed) else changed
                writer.protect(sensitive_header_values(result))
                # 保留删除意图, 防止协议后续生成的默认头重新引入该字段。
                removed_headers.update(
                    {name.lower(): None for name, value in result.items() if value is None}
                )
                removed_headers.update(
                    {
                        name.lower(): None
                        for name in headers
                        if name.lower() not in {key.lower() for key in result}
                    }
                )
                return result

            auth = await resolve_auth(
                provider,
                current,
                replace(captured, transform_headers=transform),
                credentials=self._credentials,
            )
            writer.protect([auth.key or "", *sensitive_header_values(auth.headers)])
            http = captured.http_client
            if http is None:
                if self._http_client is None:
                    self._http_client = create_http_client()
                http = self._http_client
            request_model = replace(current, base_url=auth.base_url, headers={})
            request_options = replace(
                captured,
                api_key=auth.key,
                base_url=auth.base_url,
                headers={"authorization": None, **removed_headers, **auth.headers},
                env=dict(auth.env),
                transform_headers=None,
                http_client=http,
            )
            if simple:
                assert isinstance(request_options, SimpleOptions)
                inner = provider.stream_simple(request_model, transcript, request_options)
            else:
                inner = provider.stream(request_model, transcript, request_options)
            # 延迟认证之后委托 Provider; 外层仍负责已有的取消及清理契约。
            inner._share_partial(writer.partial)
            writer.add_cleanup(inner.aclose)
            try:
                async for event in inner:
                    writer.emit(event)
            finally:
                if writer._final is None:
                    inner.cancel()

        response = AssistantResponse(current or model, produce, signal=captured.signal)
        self._responses.add(response)
        response._on_closed(self._response_closed)
        return response

    async def aclose(self) -> None:
        """Stop new calls, drain active responses and release only owned HTTP resources."""
        if self._close_task is None:
            self._state = "closing"
            self._close_task = asyncio.create_task(self._close_runtime())
        await asyncio.shield(self._close_task)

    def _response_closed(self, response: AssistantResponse) -> None:
        """Release completed calls while retaining their sanitized cleanup failures."""
        if response in self._responses:
            self._cleanup_errors.extend(response._cleanup_errors)
            self._responses.discard(response)

    async def _close_runtime(self) -> None:
        """Attempt every close before reporting failures, even for already-finished calls."""
        try:
            responses = tuple(self._responses)
            outcomes = await asyncio.gather(
                *(response.aclose() for response in responses), return_exceptions=True
            )
            for response, outcome in zip(responses, outcomes, strict=True):
                self._response_closed(response)
                if isinstance(outcome, Exception) and not response._cleanup_errors:
                    self._cleanup_errors.append(outcome)
            try:
                if self._http_client is not None:
                    await self._http_client.aclose()
            except Exception as error:
                self._cleanup_errors.append(error)
        finally:
            self._state = "closed"
        if self._cleanup_errors:
            raise ExceptionGroup("Models cleanup failed", self._cleanup_errors)

    def set_provider(self, provider: Provider) -> None:
        """Add or fully replace one provider definition."""
        snapshot = snapshot_provider(provider)
        self._providers[snapshot.id] = snapshot

    def get_provider(self, provider_id: str) -> Provider | None:
        """返回供应商独立快照。不存在时返回 None。"""
        provider = self._providers.get(provider_id)
        return copy_provider(provider) if provider is not None else None

    def get_providers(self) -> tuple[Provider, ...]:
        """列出已设置的供应商。调用方修改副本不会污染集合。"""
        return tuple(copy_provider(provider) for provider in self._providers.values())

    def delete_provider(self, provider_id: str) -> None:
        """删除配置但保留凭据和已取得的快照。"""
        self._providers.pop(provider_id, None)

    def clear(self) -> None:
        """清空供应商配置。外部凭据的生命周期由存储管理。"""
        self._providers.clear()

    def get_model(self, provider: str, model_id: str) -> Model | None:
        """Look up a provider-qualified model, returning None when absent."""
        entry = self._providers.get(provider)
        return (
            deepcopy(next((model for model in entry.get_models() if model.id == model_id), None))
            if entry
            else None
        )

    def get_models(self, provider: str | None = None) -> tuple[Model, ...]:
        """Return all models or the catalog of one provider."""
        entries = (
            self._providers.values()
            if provider is None
            else ([self._providers[provider]] if provider in self._providers else [])
        )
        return tuple(deepcopy(model) for entry in entries for model in entry.get_models())

    async def get_available_models(self, provider: str | None = None) -> tuple[Model, ...]:
        """Filter missing credentials; propagate configuration and storage failures."""
        entries = tuple(
            self._providers.values()
            if provider is None
            else ([self._providers[provider]] if provider in self._providers else [])
        )
        available: list[Model] = []
        for entry in entries:
            auth = await resolve_provider_auth(entry, AuthOverride(), self._credentials)
            for model in entry.get_models():
                headers = merge_headers(entry.headers, model.headers, auth.headers if auth else {})
                if (auth is not None and auth.key is not None) or has_auth_header(headers):
                    available.append(deepcopy(model))
        return tuple(available)

    async def resolve_auth(
        self, model: Model, overrides: AuthOverride | None = None
    ) -> ResolvedAuth:
        """Prepare authentication using the current registered model's snapshot."""
        provider = self._providers.get(model.provider)
        current = self.get_model(model.provider, model.id)
        if provider is None or current is None:
            raise ConfigurationError("Model is not registered")
        return await resolve_auth(provider, current, overrides, credentials=self._credentials)


def create_models(
    providers: Iterable[Provider] = (),
    *,
    credentials: CredentialStore | None = None,
) -> Models:
    """Create an independent model collection."""
    return Models(providers, credentials=credentials)


def create_http_client() -> httpx2.AsyncClient:
    """持有跨请求的 HTTP 连接池; 协议可以借用, Models 关闭时统一释放。"""
    return httpx2.AsyncClient(
        timeout=httpx2.Timeout(600.0, connect=5.0),
        limits=httpx2.Limits(max_connections=1000, max_keepalive_connections=100),
        follow_redirects=True,
    )
