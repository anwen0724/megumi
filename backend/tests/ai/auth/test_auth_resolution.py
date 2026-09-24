"""Authentication precedence, absence and failure are distinct contracts."""

import pytest

from app.ai.auth.memory import InMemoryCredentialStore
from app.ai.auth.resolve import resolve_auth
from app.ai.auth.types import ApiKeyCredential, AuthOverride
from app.ai.provider import Provider


class UnreadableStore(InMemoryCredentialStore):
    async def read(self, provider_id: str) -> ApiKeyCredential | None:
        raise AssertionError("Store must not be read for explicit authentication")


def unreadable_environment(name: str) -> str | None:
    raise AssertionError("Environment must not be read")


@pytest.mark.asyncio
async def test_explicit_key_bypasses_lower_priority_sources(provider: Provider) -> None:
    store = UnreadableStore()
    await store.set("sample", ApiKeyCredential("fake-stored"))
    result = await resolve_auth(
        provider,
        provider.get_models()[0],
        AuthOverride(api_key="fake-explicit"),
        credentials=store,
        env_read=unreadable_environment,
    )
    assert result.key == "fake-explicit"
    assert result.source == "explicit"
    assert "fake-explicit" not in repr(result)
    assert (await InMemoryCredentialStore.read(store, "sample")).key == "fake-stored"


@pytest.mark.asyncio
async def test_stored_key_wins_over_environment_without_mutation(provider: Provider) -> None:
    store = InMemoryCredentialStore()
    await store.set("sample", ApiKeyCredential("fake-stored"))
    result = await resolve_auth(
        provider, provider.get_models()[0], credentials=store, env_read=unreadable_environment
    )
    assert (result.key, result.source) == ("fake-stored", "stored")
    assert (await store.read("sample")).key == "fake-stored"


@pytest.mark.asyncio
async def test_environment_is_used_only_when_no_credential_is_present(
    provider: Provider, monkeypatch
) -> None:
    import os

    monkeypatch.setenv("SAMPLE_API_KEY", "fake-environment")
    result = await resolve_auth(
        provider, provider.get_models()[0], credentials=InMemoryCredentialStore()
    )
    assert (result.key, result.source) == ("fake-environment", "environment")
    assert os.environ["SAMPLE_API_KEY"] == "fake-environment"


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [None, "", " \t\n"])
async def test_empty_environment_is_not_configured(provider: Provider, value: str | None) -> None:
    from app.ai.errors import AuthError

    with pytest.raises(AuthError) as error:
        await resolve_auth(
            provider,
            provider.get_models()[0],
            credentials=InMemoryCredentialStore(),
            env_read=lambda _: value,
        )
    assert error.value.code == "not_configured"


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["", " \t\n"])
@pytest.mark.parametrize("source", ["explicit", "stored"])
async def test_invalid_selected_credential_never_falls_back(
    provider: Provider, value: str, source: str
) -> None:
    from app.ai.errors import AuthError

    store = UnreadableStore() if source == "explicit" else InMemoryCredentialStore()
    await store.set("sample", ApiKeyCredential(value if source == "stored" else "fake-valid"))
    overrides = AuthOverride(api_key=value) if source == "explicit" else None
    with pytest.raises(AuthError) as error:
        await resolve_auth(
            provider,
            provider.get_models()[0],
            overrides,
            credentials=store,
            env_read=unreadable_environment,
        )
    assert error.value.code == "invalid_credential"


@pytest.mark.asyncio
async def test_store_failure_is_distinct_and_does_not_leak_or_fall_back(provider: Provider) -> None:
    from app.ai.errors import AuthError

    class BrokenStore(InMemoryCredentialStore):
        async def read(self, provider_id: str) -> ApiKeyCredential | None:
            raise OSError("private-fake-key-in-underlying-error")

    with pytest.raises(AuthError) as error:
        await resolve_auth(
            provider,
            provider.get_models()[0],
            credentials=BrokenStore(),
            env_read=unreadable_environment,
        )
    assert error.value.code == "credential_store_error"
    assert "private-fake-key" not in str(error.value)
    assert "private-fake-key" not in repr(error.value)
    assert error.value.__suppress_context__
