"""Model collection behavior through its public interface."""

import pytest

from app.ai.models import create_models
from app.ai.provider import Provider


def test_known_model_is_found(provider: Provider) -> None:
    models = create_models([provider])
    result = models.get_model("sample", "small")
    assert result is not None
    assert (result.id, result.provider, result.context_window) == ("small", "sample", 4096)


def test_missing_model_is_a_normal_query_result(provider: Provider) -> None:
    models = create_models([provider])
    assert models.get_model("absent", "small") is None
    assert models.get_model("sample", "absent") is None


def test_lists_and_same_named_models_are_provider_qualified(provider: Provider) -> None:
    from dataclasses import replace

    other = replace(provider, id="other", models=[replace(provider.models[0], provider="other")])
    models = create_models([provider, other])
    assert models.get_model("other", "small").provider == "other"
    assert {(m.provider, m.id) for m in models.get_models()} == {
        ("sample", "small"),
        ("other", "small"),
    }
    assert [m.provider for m in models.get_models("sample")] == ["sample"]
    assert models.get_models("absent") == ()
    assert create_models().get_models() == ()


def test_setting_replaces_the_whole_provider_without_affecting_others(provider: Provider) -> None:
    from dataclasses import replace

    other = replace(provider, id="other", models=[replace(provider.models[0], provider="other")])
    models = create_models([other])
    models.set_provider(provider)
    assert models.get_model("sample", "small") is not None
    replacement = replace(
        provider,
        base_url="https://new.test/v1",
        headers={"X-Region": "new"},
        models=[replace(provider.models[0], id="large", max_output_tokens=1024)],
    )
    models.set_provider(replacement)
    assert models.get_model("sample", "small") is None
    assert models.get_model("sample", "large").max_output_tokens == 1024
    assert models.get_model("other", "small") is not None
    assert len(models.get_models()) == 2


def test_original_inputs_and_returned_models_cannot_mutate_collection(provider: Provider) -> None:
    from dataclasses import replace

    from app.ai.model import ModelCapabilities

    levels = {"low": "low"}
    headers = {"X-Trace": "original"}
    original = replace(
        provider.models[0], headers=headers, capabilities=ModelCapabilities(reasoning_levels=levels)
    )
    inputs = [original]
    models = create_models([replace(provider, models=inputs)])
    headers["X-Trace"] = "changed"
    levels["low"] = "changed"
    inputs.clear()
    result = models.get_model("sample", "small")
    assert result is not None
    assert result.headers == {"X-Trace": "original"}
    assert result.capabilities.reasoning_levels == {"low": "low"}
    result.headers["X-Trace"] = "external"
    models.get_models()[0].capabilities.reasoning_levels["low"] = "external"
    assert models.get_model("sample", "small").headers == {"X-Trace": "original"}
    assert models.get_model("sample", "small").capabilities.reasoning_levels == {"low": "low"}


@pytest.mark.asyncio
async def test_close_is_idempotent_and_existing_model_remains_readable(provider):
    models = create_models([provider])
    model = models.get_model("sample", "small")
    await models.aclose()
    await models.aclose()
    assert model is not None
    assert model.id == "small"
    assert model.context_window == 4096


@pytest.mark.asyncio
async def test_closing_runtime_keeps_static_management_and_auth_checks_available(provider):
    from dataclasses import replace

    from app.ai import ApiKeyCredential, InMemoryCredentialStore

    credentials = InMemoryCredentialStore()
    await credentials.set(provider.id, ApiKeyCredential("fake-key"))
    models = create_models([provider], credentials=credentials)
    snapshot = models.get_model("sample", "small")
    await models.aclose()
    assert models.get_model("sample", "small") == snapshot
    assert models.get_models() == (snapshot,)
    assert await models.get_available_models() == (snapshot,)
    assert (await models.resolve_auth(snapshot)).key == "fake-key"
    models.set_provider(replace(provider, name="Replacement"))
    assert models.get_provider(provider.id).name == "Replacement"
    models.delete_provider(provider.id)
    assert models.get_providers() == ()
    models.set_provider(provider)
    models.clear()
    assert models.get_models() == ()
    await models.aclose()
    assert snapshot.id == "small"


@pytest.mark.asyncio
async def test_provider_management_returns_snapshots_and_preserves_credentials(provider):
    from dataclasses import replace

    from app.ai import ApiKeyCredential, InMemoryCredentialStore

    store = InMemoryCredentialStore()
    await store.set(provider.id, ApiKeyCredential("fake-key"))
    other = replace(provider, id="other", models=[])
    models = create_models([provider, other], credentials=store)
    snapshot = models.get_provider(provider.id)
    assert models.get_provider("missing") is None
    assert [p.id for p in models.get_providers()] == ["sample", "other"]
    snapshot.headers["external"] = "value"
    assert models.get_provider(provider.id).headers == {}
    models.delete_provider(provider.id)
    models.delete_provider("missing")
    assert models.get_provider(provider.id) is None
    assert snapshot.models[0].id == "small"
    assert models.get_models() == ()
    assert [p.id for p in models.get_providers()] == ["other"]
    models.clear()
    assert models.get_providers() == ()
    assert (await store.read(provider.id)).key == "fake-key"


@pytest.mark.asyncio
async def test_provider_can_declare_multiple_protocols_without_fake_adapters(provider):
    from dataclasses import replace

    from app.ai import AuthOverride, ConfigurationError

    response_model = replace(provider.models[0], id="responses", api="openai-responses")
    mixed = replace(
        provider,
        api=("openai-completions", "openai-responses"),
        models=[provider.models[0], response_model],
    )
    models = create_models([mixed])
    assert [m.api for m in models.get_models()] == ["openai-completions", "openai-responses"]
    assert (
        await models.resolve_auth(response_model, AuthOverride(api_key="fake-key"))
    ).key == "fake-key"
    with pytest.raises(ConfigurationError):
        models.set_provider(replace(mixed, api=("openai-completions",)))
    assert len(models.get_models()) == 2
    for apis in ((), ("unknown",), ("openai-completions", "openai-completions")):
        with pytest.raises(ConfigurationError):
            create_models([replace(provider, api=apis)])
