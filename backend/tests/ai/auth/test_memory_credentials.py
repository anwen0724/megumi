"""Provider-scoped credential storage behavior."""

import pytest

from app.ai.auth.memory import InMemoryCredentialStore
from app.ai.auth.types import ApiKeyCredential


@pytest.mark.asyncio
async def test_set_and_update_credentials() -> None:
    store = InMemoryCredentialStore()
    assert await store.read("deepseek") is None
    await store.set("deepseek", ApiKeyCredential("fake-a"))
    assert (await store.read("deepseek")).key == "fake-a"
    await store.set("deepseek", ApiKeyCredential("fake-b"))
    assert (await store.read("deepseek")).key == "fake-b"


@pytest.mark.asyncio
async def test_deletion_isolated_by_provider_and_does_not_change_environment(monkeypatch) -> None:
    import os

    monkeypatch.setenv("DEEPSEEK_API_KEY", "fake-env")
    store = InMemoryCredentialStore()
    await store.set("deepseek", ApiKeyCredential("fake-a"))
    await store.set("openai", ApiKeyCredential("fake-b"))
    await store.delete("deepseek")
    assert await store.read("deepseek") is None
    assert (await store.read("openai")).key == "fake-b"
    assert os.environ["DEEPSEEK_API_KEY"] == "fake-env"
