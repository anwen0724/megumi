"""Tests for provider registration, auth resolution and request routing.

These check the path a caller actually takes: put a provider in the collection, ask a model
for a completion, and get a stream back. The credential is read from the environment, so the
tests also pin the rule that decides which source a request authenticates with.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from typing import Any

import pytest

from app.ai.auth.helpers import env_api_key_auth
from app.ai.auth.resolve import ModelsError
from app.ai.auth.types import (
    ApiKeyCredential,
    AuthResolutionOverrides,
    InMemoryCredentialStore,
    ProviderAuth,
)
from app.ai.models import (
    ModelsPublication,
    ModelsRefreshOptions,
    calculateCost,
    clampThinkingLevel,
    createModels,
    createProvider,
    getSupportedThinkingLevels,
    hasApi,
    modelsAreEqual,
)
from app.ai.providers.builtins import (
    deepseekProvider,
    huggingfaceProvider,
    moonshotaiProvider,
)
from app.ai.types import (
    Context,
    Model,
    ModelThinkingLevel,
    StopReason,
    Usage,
    UsageCost,
    UserMessage,
)
from app.ai.utils.transcript import normalize_context


def context_with(text: str = "hello") -> Any:
    """A normalized transcript with one user turn."""

    return normalize_context(Context(messages=[UserMessage(content=text, timestamp=1)]))


def usage_zero() -> Usage:
    return Usage(
        input=0,
        output=0,
        cacheRead=0,
        cacheWrite=0,
        totalTokens=0,
        cost=UsageCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0, total=0.0),
    )


class TestBuiltinProviders:
    def test_each_builtin_declares_its_identity(self) -> None:
        deepseek = deepseekProvider()

        assert deepseek.id == "deepseek"
        assert deepseek.name == "DeepSeek"
        assert deepseek.baseUrl == "https://api.deepseek.com"

    def test_a_builtin_lists_its_models(self) -> None:
        models = deepseekProvider().getModels()

        assert models
        assert {model.provider for model in models} == {"deepseek"}
        assert {model.api for model in models} == {"openai-completions"}

    def test_every_builtin_offers_key_auth(self) -> None:
        for provider in (deepseekProvider(), moonshotaiProvider(), huggingfaceProvider()):
            assert provider.auth.api_key is not None
            assert provider.auth.declared == ["api_key"]

    def test_every_model_carries_pricing_and_limits(self) -> None:
        for provider in (deepseekProvider(), moonshotaiProvider(), huggingfaceProvider()):
            for model in provider.getModels():
                assert model.contextWindow > 0
                assert model.maxTokens > 0
                assert model.cost.input >= 0


class TestCollection:
    def test_a_registered_provider_is_found_by_id(self) -> None:
        models = createModels()
        models.setProvider(deepseekProvider())

        assert models.getProvider("deepseek") is not None
        assert models.getProvider("absent") is None

    def test_models_can_be_read_for_one_provider_or_all(self) -> None:
        models = createModels()
        models.setProvider(deepseekProvider())
        models.setProvider(moonshotaiProvider())

        assert {model.provider for model in models.getModels("deepseek")} == {"deepseek"}
        assert len(models.getModels()) == len(models.getModels("deepseek")) + len(
            models.getModels("moonshotai"),
        )

    def test_an_unknown_provider_has_no_models(self) -> None:
        assert createModels().getModels("absent") == []

    def test_a_model_is_found_by_provider_and_id(self) -> None:
        models = createModels()
        models.setProvider(deepseekProvider())

        found = models.getModel("deepseek", "deepseek-chat")

        assert found is not None
        assert found.id == "deepseek-chat"
        assert models.getModel("deepseek", "absent") is None

    def test_replacing_a_provider_keeps_one_entry(self) -> None:
        models = createModels()
        models.setProvider(deepseekProvider())
        models.setProvider(deepseekProvider())

        assert len(models.getProviders()) == 1

    def test_removing_a_provider_drops_its_models(self) -> None:
        models = createModels()
        models.setProvider(deepseekProvider())

        models.deleteProvider("deepseek")

        assert models.getProviders() == []
        assert models.getModels() == []


@pytest.mark.asyncio
async def test_a_key_is_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "env-key")
    models = createModels()
    models.setProvider(deepseekProvider())

    resolved = await models.getAuth("deepseek")

    assert resolved is not None
    assert resolved.auth["apiKey"] == "env-key"
    assert resolved.source == "DEEPSEEK_API_KEY"


@pytest.mark.asyncio
async def test_an_explicit_key_wins_over_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "env-key")
    models = createModels()
    models.setProvider(deepseekProvider())

    resolved = await models.getAuth("deepseek", AuthResolutionOverrides(apiKey="explicit"))

    assert resolved is not None
    assert resolved.auth["apiKey"] == "explicit"


@pytest.mark.asyncio
async def test_an_unconfigured_provider_resolves_to_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    models = createModels()
    models.setProvider(deepseekProvider())

    assert await models.getAuth("deepseek") is None


@pytest.mark.asyncio
async def test_a_stored_credential_owns_the_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    # Once something is stored, the environment is not consulted, so a stale variable cannot
    # silently take over.
    monkeypatch.setenv("DEEPSEEK_API_KEY", "env-key")
    store = InMemoryCredentialStore()
    await store.write("deepseek", ApiKeyCredential(key="stored-key"))
    models = createModels(credentials=store)
    models.setProvider(deepseekProvider())

    resolved = await models.getAuth("deepseek")

    assert resolved is not None
    assert resolved.auth["apiKey"] == "stored-key"
    assert resolved.source == "stored credential"


@pytest.mark.asyncio
async def test_only_configured_providers_offer_models(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    monkeypatch.delenv("MOONSHOT_API_KEY", raising=False)
    models = createModels()
    models.setProvider(deepseekProvider())
    models.setProvider(moonshotaiProvider())

    available = await models.getAvailable()

    assert {model.provider for model in available} == {"deepseek"}


@pytest.mark.asyncio
async def test_login_stores_what_the_flow_returns() -> None:
    from app.ai.auth.types import AuthInteraction, AuthPrompt, AuthType

    async def prompt(_: AuthPrompt) -> str:
        return "typed-key"

    models = createModels()
    models.setProvider(deepseekProvider())

    credential = await models.login(
        "deepseek",
        AuthType.API_KEY,
        AuthInteraction(prompt=prompt),
    )

    assert isinstance(credential, ApiKeyCredential)
    assert credential.key == "typed-key"
    assert await models.getAuth("deepseek") is not None


@pytest.mark.asyncio
async def test_logout_forgets_the_credential() -> None:
    store = InMemoryCredentialStore()
    await store.write("deepseek", ApiKeyCredential(key="stored"))
    models = createModels(credentials=store)
    models.setProvider(deepseekProvider())

    await models.logout("deepseek")

    assert await store.read("deepseek") is None


@pytest.mark.asyncio
async def test_logging_in_an_unknown_provider_fails() -> None:
    from app.ai.auth.types import AuthInteraction, AuthType

    async def prompt(_: Any) -> str:
        return "x"

    with pytest.raises(ModelsError):
        await createModels().login(
            "absent",
            AuthType.API_KEY,
            AuthInteraction(prompt=prompt),
        )


@pytest.mark.asyncio
async def test_refresh_reports_nothing_to_do_for_static_providers() -> None:
    # A provider with a fixed catalogue has no refreshModels, so there is nothing to fetch.
    result = await createModels().refresh(ModelsRefreshOptions())

    assert result.aborted is False
    assert result.errors == {}


@pytest.mark.asyncio
async def test_refresh_returns_a_provider_error_instead_of_raising() -> None:
    from app.ai.models_store import ModelsStoreEntry

    class FailingProvider:
        id = "flaky"
        name = "Flaky"
        auth = ProviderAuth()
        baseUrl = None
        headers = None

        def getModels(self) -> list[Any]:
            return []

        async def refreshModels(self, context: Any) -> None:
            raise RuntimeError("upstream is down")

    models = createModels()
    models.setProvider(FailingProvider())  # type: ignore[arg-type]

    result = await models.refresh(ModelsRefreshOptions())

    assert "flaky" in result.errors
    assert isinstance(result.errors["flaky"], RuntimeError)
    del ModelsStoreEntry


@pytest.mark.asyncio
async def test_refresh_restores_the_stored_catalogue_then_fetches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.ai.auth.helpers import env_api_key_auth
    from app.ai.models_store import InMemoryModelsStore, ModelsStoreEntry

    monkeypatch.setenv("RECORDING_API_KEY", "key")
    seen: list[Any] = []

    class RecordingProvider:
        id = "dynamic"
        name = "Dynamic"
        auth = ProviderAuth(api_key=env_api_key_auth("Key", ["RECORDING_API_KEY"]))
        baseUrl = None
        headers = None

        def getModels(self) -> list[Any]:
            return []

        async def refreshModels(self, context: Any) -> None:
            seen.append((context.allowNetwork, context.stored))
            if context.allowNetwork:
                await context.publish(
                    ModelsPublication(
                        persist=ModelsStoreEntry(models=[], checkedAt=1),
                    ),
                )

    store = InMemoryModelsStore()
    await store.write("dynamic", ModelsStoreEntry(models=[], checkedAt=7))
    models = createModels(models_store=store)
    models.setProvider(RecordingProvider())  # type: ignore[arg-type]

    await models.refresh(ModelsRefreshOptions())

    # The cache-only phase runs first and is handed the stored snapshot; the network phase
    # follows it, and what it publishes replaces the stored entry.
    assert [allow for allow, _ in seen] == [False, True]
    assert seen[0][1] is not None
    assert seen[0][1].checkedAt == 7
    assert seen[1][1] is not None
    assert seen[1][1].checkedAt == 7
    stored = await store.read("dynamic")
    assert stored is not None
    assert stored.checkedAt == 1


@pytest.mark.asyncio
async def test_a_refresh_skips_the_network_when_the_provider_is_unconfigured() -> None:
    phases: list[bool] = []

    class UnconfiguredProvider:
        id = "dynamic"
        name = "Dynamic"
        auth = ProviderAuth()
        baseUrl = None
        headers = None

        def getModels(self) -> list[Any]:
            return []

        async def refreshModels(self, context: Any) -> None:
            phases.append(context.allowNetwork)

    models = createModels()
    models.setProvider(UnconfiguredProvider())  # type: ignore[arg-type]

    await models.refresh(ModelsRefreshOptions())

    # Only the cache restore happens, because there is no credential to fetch with.
    assert phases == [False]


@pytest.mark.asyncio
async def test_a_provider_without_the_models_api_streams_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The provider must be configured first, otherwise the request is refused for having no
    # credentials and the missing api is never reached.
    monkeypatch.setenv("CUSTOM_API_KEY", "key")
    provider = createProvider(
        id="custom",
        auth=ProviderAuth(api_key=env_api_key_auth("Key", ["CUSTOM_API_KEY"])),
        models=[],
        api={},
    )
    from app.ai.types import ModelCost

    model = Model(
        id="m",
        name="M",
        api="some-other-api",
        provider="custom",
        baseUrl="https://example.test",
        reasoning=False,
        input=["text"],
        cost=ModelCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0),
        contextWindow=100,
        maxTokens=10,
    )
    models = createModels()
    models.setProvider(provider)

    message = await models.stream(model, context_with()).result()

    assert message.stopReason == StopReason.ERROR
    assert message.errorMessage is not None
    assert "no API implementation" in message.errorMessage


@pytest.mark.asyncio
async def test_an_unconfigured_provider_refuses_before_sending() -> None:
    provider = createProvider(
        id="custom",
        auth=ProviderAuth(),
        models=[],
        api={},
    )
    from app.ai.types import ModelCost

    model = Model(
        id="m",
        name="M",
        api="some-other-api",
        provider="custom",
        baseUrl="https://example.test",
        reasoning=False,
        input=["text"],
        cost=ModelCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0),
        contextWindow=100,
        maxTokens=10,
    )
    models = createModels()
    models.setProvider(provider)

    message = await models.stream(model, context_with()).result()

    assert message.stopReason == StopReason.ERROR
    assert message.errorMessage is not None
    assert "not configured" in message.errorMessage


@pytest.mark.asyncio
async def test_an_unknown_provider_streams_an_error() -> None:
    from app.ai.types import ModelCost

    model = Model(
        id="m",
        name="M",
        api="openai-completions",
        provider="absent",
        baseUrl="https://example.test",
        reasoning=False,
        input=["text"],
        cost=ModelCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0),
        contextWindow=100,
        maxTokens=10,
    )

    message = await createModels().stream(model, context_with()).result()

    assert message.stopReason == StopReason.ERROR
    assert message.errorMessage is not None
    assert "Unknown provider" in message.errorMessage


class TestHelpers:
    def test_has_api_matches_the_models_api(self) -> None:
        model = deepseekProvider().getModels()[0]

        assert hasApi(model, "openai-completions")
        assert not hasApi(model, "anthropic-messages")

    def test_equality_needs_the_same_provider_and_id(self) -> None:
        left = deepseekProvider().getModels()[0]
        right = deepseekProvider().getModels()[0]

        assert modelsAreEqual(left, right)

    def test_a_model_without_reasoning_supports_only_off(self) -> None:
        model = deepseekProvider().getModels()[0]

        assert getSupportedThinkingLevels(model) == [ModelThinkingLevel.OFF]

    def test_a_reasoning_model_without_a_level_map_supports_the_base_levels(self) -> None:
        # The two highest levels are offered only when the model lists them, so a model with
        # no map supports the base levels and nothing beyond.
        model = deepseekProvider().getModels()[0]
        model.reasoning = True

        assert getSupportedThinkingLevels(model) == [
            ModelThinkingLevel.OFF,
            ModelThinkingLevel.MINIMAL,
            ModelThinkingLevel.LOW,
            ModelThinkingLevel.MEDIUM,
            ModelThinkingLevel.HIGH,
        ]

    def test_a_level_mapped_to_null_is_not_offered(self) -> None:
        model = deepseekProvider().getModels()[0]
        model.reasoning = True
        model.thinkingLevelMap = {ModelThinkingLevel.MEDIUM: None}

        assert ModelThinkingLevel.MEDIUM not in getSupportedThinkingLevels(model)

    def test_a_mapped_model_supports_the_levels_it_lists(self) -> None:
        model = deepseekProvider().getModels()[0]
        model.reasoning = True
        model.thinkingLevelMap = {
            ModelThinkingLevel.LOW: "low",
            ModelThinkingLevel.HIGH: "high",
            ModelThinkingLevel.MAX: None,
        }

        supported = getSupportedThinkingLevels(model)

        assert ModelThinkingLevel.LOW in supported
        assert ModelThinkingLevel.HIGH in supported
        assert ModelThinkingLevel.MAX not in supported

    def test_an_unsupported_level_clamps_to_the_highest_supported(self) -> None:
        model = deepseekProvider().getModels()[0]
        model.reasoning = True
        model.thinkingLevelMap = {
            ModelThinkingLevel.LOW: "low",
            ModelThinkingLevel.HIGH: "high",
        }

        assert clampThinkingLevel(model, "max") == ModelThinkingLevel.HIGH

    def test_cost_is_attached_to_the_usage(self) -> None:
        model = deepseekProvider().getModels()[0]
        usage = Usage(
            input=1_000_000,
            output=0,
            cacheRead=0,
            cacheWrite=0,
            totalTokens=1_000_000,
            cost=usage_zero().cost,
        )

        result = calculateCost(model, usage)

        assert result.cost.input == pytest.approx(model.cost.input)
        assert result.cost.total > 0


class TestEndToEnd:
    @pytest.mark.asyncio
    async def test_a_request_reaches_the_protocol_and_returns_a_message(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Drive the whole path with a scripted transport instead of a network."""

        monkeypatch.setenv("DEEPSEEK_API_KEY", "env-key")
        calls: list[Any] = []

        async def transport(request: Any) -> Any:
            from app.ai.api.openai_completions import OpenedStream
            from app.ai.types import ProviderResponse

            calls.append(request)

            async def chunks() -> AsyncIterator[Mapping[str, Any]]:
                yield {"id": "r", "choices": [{"delta": {"content": "Hi"}}]}
                yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}

            return OpenedStream(
                response=ProviderResponse(status=200, headers={}),
                chunks=chunks(),
            )

        # The provider's api is bound to the real HTTP transport, so the transport is swapped
        # in at the protocol boundary the adapter accepts.
        from app.ai.api import openai_completions as implementation

        original = implementation.stream

        def patched(
            model: Model,
            context: Any,
            options: Any,
            chunk_stream: Any,
        ) -> Any:
            return original(model, context, options, transport)

        monkeypatch.setattr(implementation, "stream", patched)

        models = createModels()
        models.setProvider(deepseekProvider())
        model = models.getModel("deepseek", "deepseek-chat")
        assert model is not None

        message = await models.stream(model, context_with("hi")).result()

        assert message.stopReason == StopReason.STOP
        assert calls, "the request never reached the protocol"
        request = calls[0]
        assert request.body["model"] == "deepseek-chat"
        assert request.body["stream"] is True
        # The resolved credential is carried into the request options the protocol reads.
        assert message.api == "openai-completions"
