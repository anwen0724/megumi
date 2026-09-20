"""Resolved request configuration preserves precedence and independent snapshots."""

from dataclasses import replace

import pytest

from app.ai.auth.memory import InMemoryCredentialStore
from app.ai.auth.resolve import resolve_auth
from app.ai.auth.types import AuthOverride
from app.ai.provider import Provider


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", [None, "https://model.test/v1"])
async def test_model_endpoint_overrides_provider_default(
    provider: Provider, endpoint: str | None
) -> None:
    model = replace(provider.models[0], base_url=endpoint)
    result = await resolve_auth(
        provider, model, AuthOverride(api_key="fake-key"), credentials=InMemoryCredentialStore()
    )
    assert result.base_url == (endpoint or "https://example.test/v1")


@pytest.mark.asyncio
async def test_headers_merge_case_insensitively_and_null_removes_defaults(
    provider: Provider,
) -> None:
    from copy import deepcopy

    pheaders = {"X-Region": "provider", "X-Delete": "remove", "X-Keep": "keep"}
    mheaders = {"x-region": "model", "X-Model": "model"}
    rheaders = {"X-REGION": "request", "x-delete": None}
    before = deepcopy((pheaders, mheaders, rheaders))
    result = await resolve_auth(
        replace(provider, headers=pheaders),
        replace(provider.models[0], headers=mheaders),
        AuthOverride(api_key="fake-key", headers=rheaders),
        credentials=InMemoryCredentialStore(),
    )
    assert {k.lower(): v for k, v in result.headers.items()} == {
        "x-region": "request",
        "x-keep": "keep",
        "x-model": "model",
        "authorization": "Bearer fake-key",
    }
    assert (pheaders, mheaders, rheaders) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["Authorization", "aUtHoRiZaTiOn", "Host", "CONTENT-LENGTH"])
@pytest.mark.parametrize("layer", ["provider", "model", "request"])
async def test_managed_headers_cannot_be_overridden(
    provider: Provider, name: str, layer: str
) -> None:
    p = replace(provider, headers={name: "bad"}) if layer == "provider" else provider
    m = (
        replace(provider.models[0], headers={name: "bad"})
        if layer == "model"
        else provider.models[0]
    )
    override = AuthOverride(api_key="fake-key", headers={name: "bad"} if layer == "request" else {})
    with pytest.raises(ValueError):
        await resolve_auth(p, m, override, credentials=InMemoryCredentialStore())


@pytest.mark.asyncio
async def test_collection_replacement_and_credential_update_leave_prior_results_intact(
    provider: Provider,
) -> None:
    from app.ai.auth.types import ApiKeyCredential
    from app.ai.models import create_models

    store = InMemoryCredentialStore()
    await store.set("sample", ApiKeyCredential("fake-a"))
    models = create_models([provider], credentials=store)
    model = models.get_model("sample", "small")
    first = await models.resolve_auth(model)
    models.set_provider(
        replace(provider, base_url="https://new.test", headers={"X-Version": "new"})
    )
    second = await models.resolve_auth(model)
    assert (first.base_url, first.key) == ("https://example.test/v1", "fake-a")
    assert (second.base_url, second.key) == ("https://new.test", "fake-a")
    await store.set("sample", ApiKeyCredential("fake-b"))
    third = await models.resolve_auth(model)
    assert third.key == "fake-b"
    assert first.key == second.key == "fake-a"


@pytest.mark.asyncio
async def test_concurrent_resolution_freezes_headers_before_waiting(provider: Provider) -> None:
    import asyncio

    from app.ai.auth.types import ApiKeyCredential

    entered = asyncio.Event()
    release = asyncio.Event()

    class BlockingStore(InMemoryCredentialStore):
        async def read(self, provider_id: str) -> ApiKeyCredential | None:
            entered.set()
            await release.wait()
            return ApiKeyCredential("fake-stored")

    headers = {"X-Request": "first"}
    first_task = asyncio.create_task(
        resolve_auth(
            provider, provider.models[0], AuthOverride(headers=headers), credentials=BlockingStore()
        )
    )
    await entered.wait()
    try:
        headers["X-Request"] = "mutated"
        second = await resolve_auth(
            provider,
            provider.models[0],
            AuthOverride(api_key="fake-explicit", headers={"X-Request": "second"}),
            credentials=InMemoryCredentialStore(),
        )
    finally:
        release.set()
    first = await first_task
    assert (first.key, first.headers["x-request"]) == ("fake-stored", "first")
    assert (second.key, second.headers["x-request"]) == ("fake-explicit", "second")
    assert first.headers is not second.headers
