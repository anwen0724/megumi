"""Available catalogs reflect local credential configuration, not remote health."""

from dataclasses import replace

import pytest

from app.ai.auth.memory import InMemoryCredentialStore
from app.ai.auth.types import ApiKeyCredential
from app.ai.errors import AuthError
from app.ai.models import create_models


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", [None, "", "  "])
async def test_available_models_filter_unconfigured_providers(provider, monkeypatch, missing):
    other = replace(
        provider,
        id="other",
        env_var="OTHER_API_KEY",
        models=[replace(provider.models[0], provider="other")],
    )
    monkeypatch.delenv("SAMPLE_API_KEY", raising=False)
    monkeypatch.delenv("OTHER_API_KEY", raising=False)
    if missing is not None:
        monkeypatch.setenv("OTHER_API_KEY", missing)
    credentials = InMemoryCredentialStore()
    await credentials.set("sample", ApiKeyCredential("fake-sample-key"))
    models = create_models([provider, other], credentials=credentials)
    available = await models.get_available_models()
    assert [(model.provider, model.id) for model in available] == [("sample", "small")]
    assert await models.get_available_models("other") == ()
    assert await models.get_available_models("unknown") == ()
    assert await create_models().get_available_models() == ()
    monkeypatch.setenv("OTHER_API_KEY", "fake-env-key")
    assert len(await models.get_available_models()) == 2
    await credentials.delete("sample")
    assert [model.provider for model in await models.get_available_models()] == ["other"]


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["store", "credential"])
async def test_failed_all_query_preserves_catalog_and_single_provider_can_succeed(
    provider, monkeypatch, fault
):
    class SelectiveStore(InMemoryCredentialStore):
        async def read(self, provider_id):
            if provider_id == "other":
                if fault == "store":
                    raise OSError("fake-sensitive-store-error")
                return ApiKeyCredential("  ")
            return ApiKeyCredential("fake-normal-key")

    monkeypatch.setenv("OTHER_API_KEY", "fake-fallback-must-not-hide-error")
    other = replace(
        provider,
        id="other",
        env_var="OTHER_API_KEY",
        models=[replace(provider.models[0], provider="other")],
    )
    models = create_models([provider, other], credentials=SelectiveStore())
    expected = "credential_store_error" if fault == "store" else "invalid_credential"
    with pytest.raises(AuthError) as caught:
        await models.get_available_models()
    assert caught.value.code == expected
    assert "fake-sensitive" not in str(caught.value)
    assert len(models.get_models()) == 2
    assert await models.get_available_models("sample") == (provider.models[0],)
