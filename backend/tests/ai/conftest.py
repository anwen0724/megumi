"""Isolated synthetic configuration samples for the new AI contracts."""

import pytest

from app.ai import ProviderAuth, create_provider, env_api_key_auth, openai_completions_api
from app.ai.model import Model
from app.ai.provider import Provider


@pytest.fixture
def provider() -> Provider:
    return create_provider(
        id="sample",
        name="Sample",
        base_url="https://example.test/v1",
        api=openai_completions_api(),
        auth=ProviderAuth(api_key=env_api_key_auth("API key", ["SAMPLE_API_KEY"])),
        models=[
            Model(
                id="small",
                name="Small",
                provider="sample",
                api="openai-completions",
                context_window=4096,
                max_output_tokens=512,
            )
        ],
    )


@pytest.fixture(autouse=True)
def isolated_credential_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prevent real credentials from entering any new AI contract test."""
    for name in ("DEEPSEEK_API_KEY", "OPENAI_API_KEY", "SAMPLE_API_KEY", "OTHER_API_KEY"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def native_sse():
    """Serialize hand-authored native events, independently of production parsing."""
    import json

    def encode(*chunks):
        return (
            "".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n"
        ).encode()

    return encode


@pytest.fixture
def sdk_harness(provider, native_sse):
    """Own the real Models and SDK; replace only the external HTTP service."""
    from contextlib import asynccontextmanager

    import httpx2

    from app.ai import Models

    @asynccontextmanager
    async def harness(*, data=None, handler=None, providers=None):
        requests = []
        if data is None:
            data = native_sse(
                {"choices": [{"index": 0, "delta": {"content": "ok"}, "finish_reason": "stop"}]}
            )

        async def respond(request):
            requests.append(request)
            if handler is not None:
                return await handler(request)
            return httpx2.Response(
                200,
                headers={"content-type": "text/event-stream", "x-request-id": "native-id"},
                content=data,
            )

        async with httpx2.AsyncClient(transport=httpx2.MockTransport(respond)) as http:
            models = Models(providers if providers is not None else [provider])
            try:
                yield models, http, requests
            finally:
                await models.aclose()

    return harness
