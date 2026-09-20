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
@pytest.mark.parametrize("name", ["Host", "CONTENT-LENGTH"])
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


@pytest.mark.asyncio
async def test_authorization_can_override_or_remove_default_bearer(provider):
    for authorization in ("Custom fake-token", None):
        result = await resolve_auth(
            provider,
            provider.models[0],
            AuthOverride(api_key="fake-key", headers={"Authorization": authorization}),
            credentials=InMemoryCredentialStore(),
        )
        assert result.headers.get("authorization") == authorization
        assert result.key == "fake-key"


@pytest.mark.asyncio
async def test_header_only_auth_is_available_per_model_and_can_be_removed(provider):
    from app.ai import AuthError, create_models

    authenticated = replace(provider.models[0], headers={"Authorization": "Custom fake-token"})
    unauthenticated = replace(provider.models[0], id="no-header")
    models = create_models([replace(provider, models=[authenticated, unauthenticated])])
    assert await models.get_available_models() == (authenticated,)
    result = await models.resolve_auth(authenticated)
    assert result.key is None and result.source == "headers"
    assert result.headers["authorization"] == "Custom fake-token"
    with pytest.raises(AuthError) as caught:
        await models.resolve_auth(authenticated, AuthOverride(headers={"Authorization": None}))
    assert caught.value.code == "not_configured"


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["explicit", "stored", "store"])
async def test_header_auth_never_masks_invalid_keys_or_store_failure(provider, fault):
    from app.ai import ApiKeyCredential, AuthError

    class Store(InMemoryCredentialStore):
        async def read(self, provider_id):
            if fault == "store":
                raise OSError("private-store-details")
            return ApiKeyCredential(" ")

    with pytest.raises(AuthError) as caught:
        await resolve_auth(
            provider,
            provider.models[0],
            AuthOverride(
                api_key=" " if fault == "explicit" else None,
                headers={"Authorization": "Custom fake-token"},
            ),
            credentials=Store(),
        )
    assert caught.value.code == (
        "credential_store_error" if fault == "store" else "invalid_credential"
    )


@pytest.mark.asyncio
async def test_scoped_environment_endpoint_and_async_transform_are_isolated(provider, monkeypatch):
    import asyncio
    import os

    entered, release = asyncio.Event(), asyncio.Event()
    monkeypatch.setenv("SAMPLE_API_KEY", "fake-process")
    env = {"SAMPLE_API_KEY": "fake-first"}
    seen = []

    class BlockingStore(InMemoryCredentialStore):
        async def read(self, provider_id):
            entered.set()
            await release.wait()
            return None

    async def transform(headers):
        seen.append(dict(headers))
        await asyncio.sleep(0)
        return {**headers, "Authorization": "Custom transformed", "X-Request": "transformed"}

    first = asyncio.create_task(
        resolve_auth(
            replace(provider, headers={"X-Request": "provider"}),
            replace(provider.models[0], headers={"X-Request": "model"}),
            AuthOverride(
                env=env,
                base_url="https://auth-first.test/v1",
                headers={"X-Request": "request"},
                transform_headers=transform,
            ),
            credentials=BlockingStore(),
        )
    )
    await entered.wait()
    try:
        env["SAMPLE_API_KEY"] = "mutated"
        second = await resolve_auth(
            provider,
            provider.models[0],
            AuthOverride(
                env={"SAMPLE_API_KEY": "fake-second"}, base_url="https://auth-second.test/v1"
            ),
            credentials=InMemoryCredentialStore(),
        )
    finally:
        release.set()
    result = await first
    assert (result.key, result.base_url) == ("fake-first", "https://auth-first.test/v1")
    assert (second.key, second.base_url) == ("fake-second", "https://auth-second.test/v1")
    assert seen == [{"x-request": "request", "authorization": "Bearer fake-first"}]
    assert result.headers == {"x-request": "transformed", "authorization": "Custom transformed"}
    assert result.env == {"SAMPLE_API_KEY": "fake-first"}
    assert os.environ["SAMPLE_API_KEY"] == "fake-process"
    fallback = await resolve_auth(
        provider,
        provider.models[0],
        AuthOverride(env={"OTHER": "local"}),
        credentials=InMemoryCredentialStore(),
    )
    assert fallback.key == "fake-process"
    assert "fake-first" not in repr(result)


@pytest.mark.asyncio
async def test_scoped_env_can_mask_external_key_and_transform_can_supply_auth(
    provider, monkeypatch
):
    from app.ai import AuthError

    monkeypatch.setenv("SAMPLE_API_KEY", "fake-process")
    with pytest.raises(AuthError) as caught:
        await resolve_auth(
            provider,
            provider.models[0],
            AuthOverride(env={"SAMPLE_API_KEY": None}),
            credentials=InMemoryCredentialStore(),
        )
    assert caught.value.code == "not_configured"
    result = await resolve_auth(
        provider,
        provider.models[0],
        AuthOverride(
            env={"SAMPLE_API_KEY": None},
            transform_headers=lambda _: {"Authorization": "Custom fake"},
        ),
        credentials=InMemoryCredentialStore(),
    )
    assert result.key is None and result.source == "headers"
    assert result.headers == {"authorization": "Custom fake"}


@pytest.mark.asyncio
async def test_transform_failure_or_invalid_output_never_returns_partial_auth(provider):
    from app.ai import ConfigurationError

    def fail(headers):
        raise RuntimeError("transform failed")

    with pytest.raises(RuntimeError, match="transform failed"):
        await resolve_auth(
            provider,
            provider.models[0],
            AuthOverride(api_key="fake-key", transform_headers=fail),
            credentials=InMemoryCredentialStore(),
        )
    for transform in (
        lambda _: {"Host": "forbidden"},
        lambda _: {"X": "bad\nvalue"},
        lambda _: None,
    ):
        with pytest.raises(ConfigurationError):
            await resolve_auth(
                provider,
                provider.models[0],
                AuthOverride(api_key="fake-key", transform_headers=transform),
                credentials=InMemoryCredentialStore(),
            )
    with pytest.raises(ConfigurationError):
        await resolve_auth(
            provider,
            provider.models[0],
            AuthOverride(api_key="fake-key", base_url="/relative"),
            credentials=InMemoryCredentialStore(),
        )


@pytest.mark.asyncio
async def test_bound_header_transform_keeps_its_callers_identity(provider):
    class Transformer:
        def __init__(self):
            self.calls = []

        def apply(self, headers):
            self.calls.append(dict(headers))
            return headers

    transformer = Transformer()
    await resolve_auth(
        provider,
        provider.models[0],
        AuthOverride(api_key="fake-key", transform_headers=transformer.apply),
        credentials=InMemoryCredentialStore(),
    )
    assert transformer.calls == [{"authorization": "Bearer fake-key"}]
