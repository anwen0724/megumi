"""Providers and the collection that routes a request to one of them.

A *provider* is the runtime unit: it owns an id, a base URL, its auth methods, its model
catalogue, and the behaviour of streaming a request. A provider does not perform auth
itself — it declares how it *can* be authenticated, and the collection resolves that before
calling it, so every request reaching a provider already carries its credentials.

A *model* names a provider and an api. The api decides which protocol implementation streams
it, so a provider offering more than one api dispatches on the model it was handed.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from app.ai.auth.context import default_provider_auth_context
from app.ai.auth.resolve import ModelsError, resolve_provider_auth
from app.ai.auth.types import (
    AuthContext,
    AuthInteraction,
    AuthRequest,
    AuthResolutionOverrides,
    AuthResult,
    AuthType,
    Credential,
    CredentialStore,
    InMemoryCredentialStore,
    OAuthCredential,
    ProviderAuth,
)
from app.ai.models_store import ModelsStore, ModelsStoreEntry, ensure_store
from app.ai.types import (
    AssistantMessage,
    AssistantMessageEvent,
    DeferredCancelOptions,
    DeferredFetchOptions,
    DeferredHandle,
    Model,
    ModelThinkingLevel,
    ProviderHeaders,
    SimpleStreamOptions,
    StreamOptions,
    TranscriptContext,
    Usage,
)
from app.ai.utils.abort import (
    AbortController,
    AbortSignal,
    operation_signal,
)
from app.ai.utils.abort_signals import combine_abort_signals
from app.ai.utils.event_stream import AssistantMessageEventStream

# Every shape of request options a public entry point accepts.
type RequestOptions = (
    StreamOptions | SimpleStreamOptions | DeferredFetchOptions | DeferredCancelOptions
)

__all__ = [
    "ModelsRefreshOptions",
    "ModelsRefreshResult",
    "MutableModels",
    "Provider",
    "ProviderStreams",
    "calculateCost",
    "clampThinkingLevel",
    "createModels",
    "createProvider",
    "getSupportedThinkingLevels",
    "hasApi",
    "lazyStream",
    "modelsAreEqual",
]


@dataclass(slots=True)
class ProviderStreams:
    """The stream contract an api implementation offers.

    Every protocol provides both entry points; the deferred ones are present only for the
    protocols that can answer asynchronously.
    """

    stream: Callable[
        [Model, TranscriptContext, StreamOptions | None],
        AssistantMessageEventStream,
    ]
    streamSimple: Callable[
        [Model, TranscriptContext, SimpleStreamOptions | None],
        AssistantMessageEventStream,
    ]
    fetchDeferred: (
        Callable[[Model, DeferredHandle, DeferredFetchOptions | None], AssistantMessageEventStream]
        | None
    ) = None
    cancelDeferred: (
        Callable[[Model, DeferredHandle, DeferredCancelOptions | None], Awaitable[None]] | None
    ) = None


@dataclass(slots=True)
class Provider:
    """A provider and everything needed to send one request to it."""

    id: str
    name: str
    auth: ProviderAuth
    baseUrl: str | None = None
    headers: ProviderHeaders | None = None
    _models: list[Model] = field(default_factory=list, repr=False)
    _streams: ProviderStreams | None = field(default=None, repr=False)
    _streams_by_api: dict[str, ProviderStreams] = field(default_factory=dict, repr=False)

    def getModels(self) -> list[Model]:
        """The models this provider currently knows about."""

        return list(self._models)

    def stream(
        self,
        model: Model,
        context: TranscriptContext,
        options: StreamOptions | None = None,
    ) -> AssistantMessageEventStream:
        """Stream a request to ``model``."""

        return self._dispatch(model, lambda streams: streams.stream(model, context, options))

    def streamSimple(
        self,
        model: Model,
        context: TranscriptContext,
        options: SimpleStreamOptions | None = None,
    ) -> AssistantMessageEventStream:
        """Stream with the simplified options."""

        return self._dispatch(model, lambda streams: streams.streamSimple(model, context, options))

    def _streams_for(self, model: Model) -> ProviderStreams | None:
        """The api implementation that serves ``model``."""

        if self._streams is not None:
            return self._streams
        return self._streams_by_api.get(model.api)

    def _dispatch(
        self,
        model: Model,
        run: Callable[[ProviderStreams], AssistantMessageEventStream],
    ) -> AssistantMessageEventStream:
        """Run one stream, reporting a missing api implementation as a stream error."""

        streams = self._streams_for(model)
        if streams is None:
            message = f'Provider {self.id} has no API implementation for "{model.api}"'
            return lazyStream(model, lambda: _fail(message))
        return run(streams)


async def _fail(message: str) -> AssistantMessageEventStream:
    """A setup step that always fails, for use with :func:`lazyStream`."""

    raise ModelsError("provider", message)


def createProvider(
    *,
    id: str,
    auth: ProviderAuth,
    models: list[Model],
    api: ProviderStreams | dict[str, ProviderStreams],
    name: str | None = None,
    baseUrl: str | None = None,
    headers: ProviderHeaders | None = None,
) -> Provider:
    """Build a provider from its parts.

    ``api`` is either one implementation that serves every model, or a map keyed by api for
    a provider whose models speak different protocols.
    """

    provider = Provider(
        id=id,
        name=name or id,
        auth=auth,
        baseUrl=baseUrl,
        headers=headers,
        _models=list(models),
    )
    if isinstance(api, ProviderStreams):
        provider._streams = api
    else:
        provider._streams_by_api = dict(api)
    return provider


@dataclass(slots=True)
class ModelsRefreshOptions:
    """Which providers to refresh, and how."""

    providers: list[str] | None = None
    allowNetwork: bool = True
    force: bool | None = None
    signal: AbortSignal | None = None


@dataclass(slots=True)
class ModelsRefreshResult:
    """What a refresh did.

    An error is returned rather than raised, so one unreachable provider does not hide what
    the others managed to do.
    """

    aborted: bool = False
    errors: dict[str, BaseException] = field(default_factory=dict)


@dataclass(slots=True)
class ModelsPublication:
    """What a provider wants recorded after a refresh phase.

    ``persist`` left unset leaves storage alone, an entry replaces it, and ``None`` deletes
    it. ``update`` runs only once the persistence it belongs with has been applied, so a
    provider's in-memory state never claims something storage rejected.
    """

    persist: ModelsStoreEntry | None = None
    delete_persisted: bool = False
    update: Callable[[], None] | None = None


class RefreshModelsContext:
    """What a provider is given while refreshing its catalogue.

    A provider restores the stored snapshot first and only then goes to the network, so a
    refresh that fails still leaves the caller with the last known models.
    """

    def __init__(
        self,
        credential: Credential | None,
        stored: ModelsStoreEntry | None,
        publish: Callable[[ModelsPublication], Awaitable[bool]],
        allow_network: bool,
        force: bool | None,
        signal: AbortSignal,
    ) -> None:
        self.credential = credential
        self.stored = stored
        self.publish = publish
        self.allowNetwork = allow_network
        self.force = force
        self.signal = signal


class MutableModels:
    """The collection of providers, plus auth resolution and the stream entry points."""

    def __init__(
        self,
        credentials: CredentialStore | None = None,
        auth_context: AuthContext | None = None,
        models_store: ModelsStore | None = None,
    ) -> None:
        self._providers: dict[str, Provider] = {}
        self._credentials = credentials if credentials is not None else InMemoryCredentialStore()
        self._auth_context = auth_context
        self._models_store = ensure_store(models_store)
        self._refresh_generations: dict[str, int] = {}
        self._refresh_controllers: dict[str, AbortController] = {}
        self._publication_chains: dict[str, asyncio.Future[None]] = {}

    # -- provider registration -------------------------------------------------

    def setProvider(self, provider: Provider) -> None:
        """Add or replace a provider by its id."""

        self._providers[provider.id] = provider

    def deleteProvider(self, id: str) -> None:
        """Remove a provider."""

        self._providers.pop(id, None)

    def clearProviders(self) -> None:
        """Remove every provider."""

        self._providers.clear()

    def getProviders(self) -> list[Provider]:
        """Every registered provider."""

        return list(self._providers.values())

    def getProvider(self, id: str) -> Provider | None:
        """One provider by id."""

        return self._providers.get(id)

    # -- models ----------------------------------------------------------------

    def getModels(self, provider: str | None = None) -> list[Model]:
        """The last-known models of one provider, or of all of them.

        A provider that fails to list its models contributes none rather than failing the
        whole call, because this is a best-effort read used for lookups and menus.
        """

        if provider is not None:
            entry = self._providers.get(provider)
            if entry is None:
                return []
            try:
                return entry.getModels()
            except BaseException:
                return []
        found: list[Model] = []
        for entry in self._providers.values():
            try:
                found.extend(entry.getModels())
            except BaseException:
                continue
        return found

    def getModel(self, provider: str, id: str) -> Model | None:
        """One model by provider and id."""

        for model in self.getModels(provider):
            if model.id == id:
                return model
        return None

    async def refresh(self, options: ModelsRefreshOptions | None = None) -> ModelsRefreshResult:
        """Re-read the model lists of the providers that have a dynamic catalogue.

        Each provider is refreshed independently, so one failure is reported beside the
        others' results rather than replacing them. A provider restores its stored catalogue
        before anything else, which means a refresh that cannot reach the network still
        leaves the caller with the last known models.
        """

        resolved = options if options is not None else ModelsRefreshOptions()
        allow_network = resolved.allowNetwork
        caller_signal = operation_signal(resolved.signal)
        errors: dict[str, BaseException] = {}
        if caller_signal.aborted:
            return ModelsRefreshResult(aborted=True, errors=errors)

        selected = set(resolved.providers) if resolved.providers is not None else None
        refreshable = [
            provider
            for provider in self._providers.values()
            if getattr(provider, "refreshModels", None) is not None
            and (selected is None or provider.id in selected)
        ]

        async def refresh_one(provider: Provider) -> None:
            generation, controller = self._begin_refresh(provider.id)
            signal = _combine_signals(caller_signal, controller.signal)
            stored_credential: Credential | None = None
            credential_error: BaseException | None = None
            try:
                try:
                    stored_credential = await self._read_credential(provider.id, signal)
                except BaseException as error:
                    credential_error = error

                # Cached state is restored before auth resolution or any network access.
                await self._run_refresh_phase(
                    provider, stored_credential, False, None, generation, signal
                )
                if credential_error is not None:
                    raise credential_error
                if not allow_network or signal.aborted:
                    return

                credential = await self._refresh_credential(provider, stored_credential, signal)
                if credential is None:
                    return
                await self._run_refresh_phase(
                    provider, credential, True, resolved.force, generation, signal
                )
            finally:
                if self._refresh_controllers.get(provider.id) is controller:
                    del self._refresh_controllers[provider.id]

        async def guarded(provider: Provider) -> None:
            generation = self._refresh_generations.get(provider.id, 0)
            del generation
            try:
                await refresh_one(provider)
            except BaseException as error:
                errors[provider.id] = error

        await asyncio.gather(*(guarded(provider) for provider in refreshable))
        return ModelsRefreshResult(aborted=caller_signal.aborted, errors=errors)

    def _supersede_refresh(self, provider_id: str) -> int:
        """Start a new refresh generation, cancelling the previous one for that provider."""

        generation = self._refresh_generations.get(provider_id, 0) + 1
        self._refresh_generations[provider_id] = generation
        previous = self._refresh_controllers.pop(provider_id, None)
        if previous is not None:
            previous.abort()
        return generation

    def _begin_refresh(self, provider_id: str) -> tuple[int, AbortController]:
        """Claim the refresh slot for one provider."""

        generation = self._supersede_refresh(provider_id)
        controller = AbortController()
        self._refresh_controllers[provider_id] = controller
        return generation, controller

    async def _publish_provider_models(
        self,
        provider_id: str,
        generation: int,
        signal: AbortSignal,
        publication: ModelsPublication,
    ) -> bool:
        """Apply one publication, unless a newer refresh has already superseded it.

        Publications for one provider are serialised, so two phases cannot interleave and a
        superseded one never writes after its replacement.
        """

        previous = self._publication_chains.get(provider_id)
        if previous is not None:
            with contextlib.suppress(BaseException):
                await previous
        if signal.aborted or self._refresh_generations.get(provider_id) != generation:
            return False

        if publication.delete_persisted:
            await self._models_store.delete(provider_id)
        elif publication.persist is not None:
            await self._models_store.write(provider_id, publication.persist)

        if signal.aborted or self._refresh_generations.get(provider_id) != generation:
            return False
        if publication.update is not None:
            publication.update()
        return True

    async def _run_refresh_phase(
        self,
        provider: Provider,
        credential: Credential | None,
        allow_network: bool,
        force: bool | None,
        generation: int,
        signal: AbortSignal,
    ) -> None:
        """Give the provider one refresh phase and the means to publish what it found."""

        refresh_models = getattr(provider, "refreshModels", None)
        if refresh_models is None:
            return
        stored = await self._models_store.read(provider.id)

        async def publish(publication: ModelsPublication) -> bool:
            return await self._publish_provider_models(
                provider.id,
                generation,
                signal,
                publication,
            )

        context = RefreshModelsContext(
            credential=credential,
            stored=stored,
            publish=publish,
            allow_network=allow_network,
            force=force if allow_network else None,
            signal=signal,
        )
        await refresh_models(context)

    async def _read_credential(self, provider_id: str, signal: AbortSignal) -> Credential | None:
        """Read the stored credential, reporting a store failure as an auth error."""

        del signal
        try:
            return await self._credentials.read(provider_id)
        except BaseException as error:
            raise ModelsError(
                "auth",
                f"Credential store read failed for {provider_id}",
                error,
            ) from error

    async def _refresh_credential(
        self,
        provider: Provider,
        stored: Credential | None,
        signal: AbortSignal,
    ) -> Credential | None:
        """The credential a network refresh should use, renewing an expired token."""

        from app.ai.auth.types import ApiKeyCredential, OAuthCredential

        if isinstance(stored, OAuthCredential):
            oauth = provider.auth.oauth
            if oauth is None:
                return None
            if not _oauth_expired(stored):
                return stored
            if signal.aborted:
                return None
            renewed: Credential | None = None

            async def refresh(current: Credential | None) -> Credential | None:
                nonlocal renewed
                if not isinstance(current, OAuthCredential) or not _oauth_expired(current):
                    return None
                if oauth.refresh is None:
                    return None
                renewed = await oauth.refresh(current, signal)
                return renewed

            await self._credentials.modify(provider.id, refresh)
            return renewed if isinstance(renewed, OAuthCredential) else None

        api_key_auth = provider.auth.api_key
        if api_key_auth is None:
            return None
        credential = stored if isinstance(stored, ApiKeyCredential) else None
        result = await api_key_auth.resolve(
            AuthRequest(
                ctx=self._auth_context or default_provider_auth_context(),
                credential=credential,
                signal=signal,
            ),
        )
        if result is None:
            return None
        key = result.auth.get("apiKey")
        if not isinstance(key, str):
            return None
        return ApiKeyCredential(key=key, env=result.env)

    # -- auth ------------------------------------------------------------------

    async def checkAuth(
        self,
        provider_id: str,
        overrides: AuthResolutionOverrides | None = None,
    ) -> AuthResult | None:
        """Resolve auth without renewing an OAuth token."""

        return await self.getAuth(provider_id, overrides)

    async def getAvailable(
        self,
        provider_id: str | None = None,
        overrides: AuthResolutionOverrides | None = None,
    ) -> list[Model]:
        """The models whose providers are configured."""

        available: list[Model] = []
        for provider in self._providers.values():
            if provider_id is not None and provider.id != provider_id:
                continue
            resolved = await self.getAuth(provider.id, overrides)
            if resolved is not None:
                available.extend(self.getModels(provider.id))
        return available

    async def getAuth(
        self,
        provider_or_model: str | Model,
        overrides: AuthResolutionOverrides | None = None,
    ) -> AuthResult | None:
        """Resolve the auth for a provider or for a model's provider."""

        provider_id = (
            provider_or_model.provider
            if isinstance(provider_or_model, Model)
            else provider_or_model
        )
        provider = self._providers.get(provider_id)
        if provider is None:
            return None
        return await resolve_provider_auth(
            provider.id,
            provider.auth,
            self._credentials,
            self._auth_context,
            overrides,
        )

    async def login(
        self,
        provider_id: str,
        type: AuthType,
        interaction: AuthInteraction,
    ) -> Credential:
        """Run a provider's login flow and store what it returns."""

        provider = self._providers.get(provider_id)
        if provider is None:
            raise ModelsError("auth", f"Unknown provider {provider_id}")
        method = provider.auth.api_key if type == AuthType.API_KEY else provider.auth.oauth
        if method is None or method.login is None:
            raise ModelsError("auth", f"Provider {provider_id} has no {type} login")
        credential = await method.login(interaction)
        await self._credentials.write(provider_id, credential)
        return credential

    async def logout(
        self,
        provider_id: str,
        options: AuthResolutionOverrides | None = None,
    ) -> None:
        """Forget a provider's stored credential."""

        del options
        await self._credentials.write(provider_id, None)

    # -- streaming -------------------------------------------------------------

    def stream(
        self,
        model: Model,
        context: TranscriptContext,
        options: StreamOptions | None = None,
    ) -> AssistantMessageEventStream:
        """Stream a request, resolving auth before the provider is called."""

        setup = self._authorized_stream(model, options, context, simple=False)
        return lazyStream(model, setup)

    async def complete(
        self,
        model: Model,
        context: TranscriptContext,
        options: StreamOptions | None = None,
    ) -> AssistantMessage:
        """Stream a request and return its terminal message."""

        return await self.stream(model, context, options).result()

    def streamSimple(
        self,
        model: Model,
        context: TranscriptContext,
        options: SimpleStreamOptions | None = None,
    ) -> AssistantMessageEventStream:
        """Stream with the simplified options, resolving auth first."""

        setup = self._authorized_stream(model, options, context, simple=True)
        return lazyStream(model, setup)

    async def completeSimple(
        self,
        model: Model,
        context: TranscriptContext,
        options: SimpleStreamOptions | None = None,
    ) -> AssistantMessage:
        """Stream with the simplified options and return the terminal message."""

        return await self.streamSimple(model, context, options).result()

    def _authorized_stream(
        self,
        model: Model,
        options: StreamOptions | SimpleStreamOptions | None,
        transcript: TranscriptContext,
        *,
        simple: bool,
    ) -> Callable[[], Awaitable[AssistantMessageEventStream]]:
        """A setup step that resolves auth, then asks the provider to stream."""

        async def setup() -> AssistantMessageEventStream:
            provider = self._providers.get(model.provider)
            if provider is None:
                raise ModelsError("provider", f"Unknown provider {model.provider}")
            resolved = await resolve_provider_auth(
                provider.id,
                provider.auth,
                self._credentials,
                self._auth_context,
                _overrides_from(options),
            )
            if resolved is None:
                # An unconfigured provider has no credentials to send, so the request is
                # refused here rather than sent and rejected by the server.
                raise ModelsError("auth", f"Provider is not configured: {model.provider}")
            request_model, request_options = _apply_auth(model, options, resolved)
            if simple:
                return provider.streamSimple(
                    request_model,
                    transcript,
                    request_options if isinstance(request_options, SimpleStreamOptions) else None,
                )
            return provider.stream(
                request_model,
                transcript,
                request_options if isinstance(request_options, StreamOptions) else None,
            )

        return setup

    def streamDeferred(
        self,
        model: Model,
        handle: DeferredHandle,
        options: DeferredFetchOptions | None = None,
    ) -> AssistantMessageEventStream:
        """Resume a request the provider deferred, resolving auth first."""

        setup = self._authorized_deferred(model, handle, options)
        return lazyStream(model, setup)

    async def fetchDeferred(
        self,
        model: Model,
        handle: DeferredHandle,
        options: DeferredFetchOptions | None = None,
    ) -> AssistantMessage:
        """Resume a deferred request and return its terminal message."""

        return await self.streamDeferred(model, handle, options).result()

    async def cancelDeferred(
        self,
        model: Model,
        handle: DeferredHandle,
        options: DeferredCancelOptions | None = None,
    ) -> None:
        """Ask the provider to abandon a deferred response."""

        provider = self._providers.get(model.provider)
        if provider is None:
            raise ModelsError("provider", f"Unknown provider {model.provider}")
        streams = provider._streams_for(model)
        if streams is None or streams.cancelDeferred is None:
            raise ModelsError("provider", _no_deferred_message(model))
        resolved = await resolve_provider_auth(
            provider.id,
            provider.auth,
            self._credentials,
            self._auth_context,
            _overrides_from(options),
        )
        if resolved is None:
            raise ModelsError("auth", f"Provider is not configured: {model.provider}")
        request_model, request_options = _apply_auth(model, options, resolved)
        cancelled_options = (
            request_options if isinstance(request_options, DeferredFetchOptions) else None
        )
        await streams.cancelDeferred(request_model, handle, cancelled_options)

    def _authorized_deferred(
        self,
        model: Model,
        handle: DeferredHandle,
        options: DeferredFetchOptions | None,
    ) -> Callable[[], Awaitable[AssistantMessageEventStream]]:
        """A setup step that resolves auth, then asks the provider to resume the request."""

        async def setup() -> AssistantMessageEventStream:
            provider = self._providers.get(model.provider)
            if provider is None:
                raise ModelsError("provider", f"Unknown provider {model.provider}")
            streams = provider._streams_for(model)
            if streams is None or streams.fetchDeferred is None:
                raise ModelsError("provider", _no_deferred_message(model))
            resolved = await resolve_provider_auth(
                provider.id,
                provider.auth,
                self._credentials,
                self._auth_context,
                _overrides_from(options),
            )
            if resolved is None:
                raise ModelsError("auth", f"Provider is not configured: {model.provider}")
            request_model, request_options = _apply_auth(model, options, resolved)
            return streams.fetchDeferred(
                request_model,
                handle,
                request_options if isinstance(request_options, DeferredFetchOptions) else None,
            )

        return setup


def _no_deferred_message(model: Model) -> str:
    """Why a provider cannot answer a deferred request for this model."""

    return (
        f"Provider {model.provider} does not support deferred responses "
        f'for "{model.api}"'
    )


def _overrides_from(options: RequestOptions | None) -> AuthResolutionOverrides:
    """The auth overrides a request carries."""

    if options is None:
        return AuthResolutionOverrides()
    return AuthResolutionOverrides(apiKey=options.apiKey, env=options.env)


def _apply_auth(
    model: Model,
    options: RequestOptions | None,
    resolved: AuthResult,
) -> tuple[Model, RequestOptions | None]:
    """Attach the resolved credentials, headers and endpoint to the request.

    An explicit request option wins per field, and the resolved environment merges under
    whatever the caller scoped, so a caller's value is never overridden by resolution.
    """

    if options is None:
        return model, None
    api_key = resolved.auth.get("apiKey")
    if isinstance(api_key, str):
        options.apiKey = api_key

    resolved_headers = resolved.auth.get("headers")
    if isinstance(resolved_headers, Mapping):
        options.headers = _merge_headers(
            {**(options.headers or {}), **(model.headers or {})},
            resolved_headers,
        )
    if resolved.env:
        options.env = {**resolved.env, **(options.env or {})}

    # A credential can redirect the request, which is how a subscription account reaches a
    # different host than the provider's public endpoint.
    base_url = resolved.auth.get("baseUrl")
    if isinstance(base_url, str) and base_url:
        model = replace(model, baseUrl=base_url)
    return model, options


def _merge_headers(
    base: Mapping[str, str | None] | None,
    override: Mapping[str, str | None] | None,
) -> dict[str, str | None]:
    """Overlay headers, replacing an existing name whatever its casing."""

    merged: dict[str, str | None] = dict(base or {})
    for name, value in (override or {}).items():
        lowered = name.lower()
        for existing in [key for key in merged if key.lower() == lowered]:
            del merged[existing]
        merged[name] = value
    return merged


def _combine_signals(caller: AbortSignal, provider: AbortSignal) -> AbortSignal:
    """A signal that aborts when either the caller's or the provider's does.

    A provider's own refresh is cancelled when a newer generation replaces it, while the
    caller's signal is shared across every provider being refreshed.
    """

    combined = combine_abort_signals([caller, provider])
    return combined.signal if combined.signal is not None else caller


def _oauth_expired(credential: OAuthCredential) -> bool:
    """Whether a token has expired and must be renewed before it is used."""

    expires_at = credential.expiresAt
    if expires_at is None:
        return False
    return int(time.time() * 1000) >= expires_at


def createModels(
    credentials: CredentialStore | None = None,
    auth_context: AuthContext | None = None,
    models_store: ModelsStore | None = None,
) -> MutableModels:
    """Build an empty collection of providers."""

    return MutableModels(
        credentials=credentials,
        auth_context=auth_context,
        models_store=models_store,
    )


def hasApi(model: Model, api: str) -> bool:
    """Whether ``model`` is streamed by ``api``."""

    return model.api == api


def calculateCost(model: Model, usage: Usage) -> Usage:
    """Price a usage block with the model's rates, applying a tier when one matches.

    The highest matching input threshold applies to the whole request. Input, cache reads and
    cache writes all count toward the threshold.
    """

    from app.ai.api.openai_completions import calculate_cost as price

    usage.cost = price(model, usage)
    return usage


EXTENDED_THINKING_LEVELS: tuple[ModelThinkingLevel, ...] = (
    ModelThinkingLevel.OFF,
    ModelThinkingLevel.MINIMAL,
    ModelThinkingLevel.LOW,
    ModelThinkingLevel.MEDIUM,
    ModelThinkingLevel.HIGH,
    ModelThinkingLevel.XHIGH,
    ModelThinkingLevel.MAX,
)


def getSupportedThinkingLevels(model: Model) -> list[ModelThinkingLevel]:
    """The thinking levels this model can be asked for.

    A model without reasoning offers only ``off``. A level the model maps to null is one it
    cannot be asked for, and the two highest levels are offered only when the model lists
    them, because they are not universally available.
    """

    if not model.reasoning:
        return [ModelThinkingLevel.OFF]
    mapping = model.thinkingLevelMap or {}
    supported: list[ModelThinkingLevel] = []
    for level in EXTENDED_THINKING_LEVELS:
        if level in (ModelThinkingLevel.XHIGH, ModelThinkingLevel.MAX):
            if mapping.get(level) is not None:
                supported.append(level)
            continue
        if mapping and level in mapping and mapping[level] is None:
            continue
        supported.append(level)
    return supported


def clampThinkingLevel(model: Model, level: str) -> ModelThinkingLevel:
    """Reduce ``level`` to the closest level the model supports.

    A level the model cannot be asked for falls back to the first supported level above it,
    and only then to the first one below, so a request is not silently strengthened past what
    the caller asked for while a weaker level is still available.
    """

    supported = getSupportedThinkingLevels(model)
    known = {item.value for item in ModelThinkingLevel}
    wanted = ModelThinkingLevel(level) if level in known else None
    if wanted is not None and wanted in supported:
        return wanted
    if wanted is None:
        return supported[0] if supported else ModelThinkingLevel.OFF

    requested_index = EXTENDED_THINKING_LEVELS.index(wanted)
    for candidate in EXTENDED_THINKING_LEVELS[requested_index:]:
        if candidate in supported:
            return candidate
    for candidate in reversed(EXTENDED_THINKING_LEVELS[:requested_index]):
        if candidate in supported:
            return candidate
    return supported[0] if supported else ModelThinkingLevel.OFF


def modelsAreEqual(left: Model, right: Model) -> bool:
    """Whether two catalog entries describe the same model."""

    return (
        left.id == right.id
        and left.provider == right.provider
        and left.api == right.api
    )


def lazyStream(
    model: Model,
    setup: Callable[[], Awaitable[AssistantMessageEventStream]],
) -> AssistantMessageEventStream:
    """Return a stream synchronously while running setup behind it.

    Setup covers credential resolution and, for a lazily loaded api, importing the protocol.
    A setup failure has to arrive as an error event rather than a raise, because the caller
    already holds the stream.
    """

    import asyncio

    outer = AssistantMessageEventStream()

    async def forward() -> None:
        try:
            inner = await setup()
        except BaseException as error:
            message = _setup_error_message(model, error)
            outer.push(_error_event(message))
            outer.end(message)
            return
        async for event in inner:
            outer.push(event)
        outer.end(await inner.result())

    runner = asyncio.ensure_future(forward())
    _SETUP_RUNNERS.add(runner)
    runner.add_done_callback(_SETUP_RUNNERS.discard)
    return outer


# Keeps references to the setup tasks so none is collected before it finishes.
_SETUP_RUNNERS: set[Any] = set()


def _setup_error_message(model: Model, error: BaseException) -> AssistantMessage:
    """The terminal message a failed setup produces."""

    from app.ai.api.openai_completions import _empty_usage
    from app.ai.types import StopReason

    return AssistantMessage(
        content=[],
        api=model.api,
        provider=model.provider,
        model=model.id,
        usage=_empty_usage(),
        stopReason=StopReason.ERROR,
        errorMessage=str(error),
        timestamp=int(time.time() * 1000),
    )


def _error_event(message: AssistantMessage) -> AssistantMessageEvent:
    """The event that terminates a stream whose setup failed."""

    from app.ai.types import EventError

    return EventError(reason="error", error=message)
