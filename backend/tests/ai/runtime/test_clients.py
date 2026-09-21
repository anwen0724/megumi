"""Actual SDK construction and request-scoped HTTP ownership."""

import httpx2
import pytest
from openai import RateLimitError

from app.ai.auth.types import ResolvedAuth
from app.ai.options import CallOptions
from app.ai.runtime.clients import ClientRuntime
from app.ai.stream import AssistantResponse


async def create_response_stream(client, payload, request_options):
    """Exercise the real SDK endpoint with a minimal test-only protocol request."""
    return await client.responses.create(
        model="sample", input="hello", stream=True, extra_body=payload, **request_options
    )


async def create_chat_stream(client, payload, request_options):
    """Exercise the real Chat endpoint without implementing message conversion."""
    return await client.chat.completions.create(
        model="sample", messages=[], stream=True, extra_body=payload, **request_options
    )


@pytest.mark.asyncio
async def test_sdk_does_not_retry_outside_shared_request_policy(provider):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx2.Response(429, json={"error": {"message": "slow down"}})

    http = httpx2.AsyncClient(transport=httpx2.MockTransport(handle))
    runtime = ClientRuntime()
    auth = ResolvedAuth(
        key="fake-key",
        source="explicit",
        base_url=provider.base_url,
        headers={"authorization": "Bearer fake-key"},
    )

    async def produce(writer):
        with pytest.raises(RateLimitError):
            await runtime.open_stream(
                create_chat_stream,
                {"stream": True},
                model=provider.models[0],
                auth=auth,
                options=CallOptions(http_client=http),
                writer=writer,
            )
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    try:
        assert (await AssistantResponse(provider.models[0], produce).result()).stop_reason == "stop"
        assert len(requests) == 1
        assert not http.is_closed
    finally:
        await runtime.aclose()
        await http.aclose()


@pytest.mark.asyncio
async def test_shared_retry_reads_sdk_status_and_headers_and_borrows_client(provider):
    requests, responses = [], []

    def handle(request):
        requests.append(request)
        if len(requests) == 1:
            response = httpx2.Response(
                429, headers={"retry-after-ms": "0"}, json={"error": {"message": "slow down"}}
            )
        else:
            response = httpx2.Response(200, content=b'data: {"value": 1}\n\ndata: [DONE]\n\n')
        responses.append(response)
        return response

    http = httpx2.AsyncClient(transport=httpx2.MockTransport(handle))
    runtime = ClientRuntime()

    async def produce(writer):
        stream = await runtime.open_stream(
            create_chat_stream,
            {"stream": True},
            model=provider.models[0],
            auth=ResolvedAuth(
                key="fake",
                source="explicit",
                base_url=provider.base_url,
                headers={"authorization": "Bearer fake"},
            ),
            options=CallOptions(http_client=http, max_retries=1),
            writer=writer,
        )
        assert [item.value async for item in stream] == [1]
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    try:
        final = await AssistantResponse(provider.models[0], produce).result()
        assert final.stop_reason == "stop", final.error_message
        assert len(requests) == 2
        assert all(response.is_closed for response in responses)
        await runtime.aclose()
        assert not http.is_closed
    finally:
        await http.aclose()


@pytest.mark.asyncio
async def test_resolved_configuration_is_authoritative_and_timeout_is_per_request(
    provider, monkeypatch
):
    monkeypatch.setenv("OPENAI_CUSTOM_HEADERS", "X-Ambient: should-not-leak")
    monkeypatch.setenv("OPENAI_ORG_ID", "ambient-org")
    requests = []

    def handle(request):
        requests.append(request)
        return httpx2.Response(200, content=b"data: [DONE]\n\n")

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle), timeout=17) as http:
        runtime = ClientRuntime()
        for key, timeout in [("first-key", 250), ("second-key", None)]:

            async def produce(writer, key=key, timeout=timeout):
                stream = await runtime.open_stream(
                    create_response_stream,
                    {"stream": True},
                    model=provider.models[0],
                    auth=ResolvedAuth(
                        key=key,
                        source="explicit",
                        base_url="https://override.test/custom/",
                        headers={"authorization": f"Bearer {key}", "x-scope": key},
                    ),
                    options=CallOptions(http_client=http, timeout_ms=timeout),
                    writer=writer,
                )
                async for _ in stream:
                    pass
                writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

            final = await AssistantResponse(provider.models[0], produce).result()
            assert final.stop_reason == "stop", final.error_message
        assert [str(r.url) for r in requests] == ["https://override.test/custom/responses"] * 2
        assert [r.headers["authorization"] for r in requests] == [
            "Bearer first-key",
            "Bearer second-key",
        ]
        assert all(
            "x-ambient" not in r.headers and "openai-organization" not in r.headers
            for r in requests
        )
        assert [r.extensions["timeout"]["read"] for r in requests] == [0.25, 17]
        await runtime.aclose()
        assert not http.is_closed


@pytest.mark.asyncio
async def test_owned_http_client_is_lazy_shared_and_closed_by_owner(provider, monkeypatch):
    import app.ai.runtime.clients as clients

    created = []

    def factory():
        http = httpx2.AsyncClient(
            transport=httpx2.MockTransport(
                lambda request: httpx2.Response(200, content=b"data: [DONE]\n\n")
            )
        )
        created.append(http)
        return http

    monkeypatch.setattr(clients, "DefaultAsyncHttpxClient", factory)
    runtime = ClientRuntime()
    assert created == []

    async def produce(writer):
        stream = await runtime.open_stream(
            create_response_stream,
            {},
            model=provider.models[0],
            auth=ResolvedAuth(
                key="fake",
                source="explicit",
                base_url=provider.base_url,
                headers={"authorization": "Bearer fake"},
            ),
            options=CallOptions(),
            writer=writer,
        )
        async for _ in stream:
            pass
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    for _ in range(2):
        assert (await AssistantResponse(provider.models[0], produce).result()).stop_reason == "stop"
    assert len(created) == 1 and not created[0].is_closed
    await runtime.aclose()
    await runtime.aclose()
    assert created[0].is_closed


@pytest.mark.asyncio
async def test_header_overrides_are_not_duplicated_and_removed_auth_is_not_reintroduced(provider):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx2.Response(200, content=b"data: [DONE]\n\n")

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle)) as http:
        runtime = ClientRuntime()

        async def produce(writer):
            stream = await runtime.open_stream(
                create_response_stream,
                {},
                model=provider.models[0],
                auth=ResolvedAuth(
                    key="fake",
                    source="explicit",
                    base_url=provider.base_url,
                    headers={"content-type": "application/json", "accept": "text/event-stream"},
                ),
                options=CallOptions(http_client=http),
                writer=writer,
            )
            async for _ in stream:
                pass
            writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

        final = await AssistantResponse(provider.models[0], produce).result()
        assert final.stop_reason == "stop", final.error_message
        assert "authorization" not in requests[0].headers
        assert requests[0].headers["content-type"] == "application/json"
        assert requests[0].headers["accept"] == "text/event-stream"
        await runtime.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("protocol", ["chat", "responses"])
async def test_protocol_sdk_operation_preserves_extra_body_and_native_event_fields(
    provider, protocol
):
    import json

    requests, seen = [], []
    chunk = (
        {
            "id": "c1",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "sample",
            "choices": [
                {"index": 0, "delta": {"reasoning_content": "thinking"}, "finish_reason": None}
            ],
        }
        if protocol == "chat"
        else {
            "type": "response.output_text.delta",
            "item_id": "item1",
            "output_index": 0,
            "content_index": 0,
            "sequence_number": 1,
            "delta": "answer",
            "provider_extra": "preserved",
        }
    )

    def handle(request):
        requests.append(request)
        return httpx2.Response(
            200,
            headers={"x-request-id": "request1"},
            content=("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode(),
        )

    async def operation(client, payload, request_options):
        if protocol == "chat":
            return await client.chat.completions.create(
                model="sample", messages=[], stream=True, extra_body=payload, **request_options
            )
        return await client.responses.create(
            model="sample", input="hello", stream=True, extra_body=payload, **request_options
        )

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle)) as http:
        runtime = ClientRuntime()

        async def produce(writer):
            stream = await runtime.open_stream(
                operation,
                {"provider_extension": {"enabled": True}},
                model=provider.models[0],
                auth=ResolvedAuth(
                    key="fake",
                    source="explicit",
                    base_url=provider.base_url,
                    headers={"authorization": "Bearer fake"},
                ),
                options=CallOptions(
                    http_client=http,
                    on_response=lambda response, model: seen.append(
                        response.headers["x-request-id"]
                    ),
                ),
                writer=writer,
            )
            async for event in stream:
                if protocol == "chat":
                    seen.append(event.choices[0].delta.model_extra["reasoning_content"])
                else:
                    seen.append(event.delta)
                    seen.append(event.model_extra["provider_extra"])
            writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

        response = AssistantResponse(provider.models[0], produce)
        final = await response.result()
        await response.aclose()
        await runtime.aclose()
        assert final.stop_reason == "stop", final.error_message
        assert requests[0].url.path.endswith(
            "/chat/completions" if protocol == "chat" else "/responses"
        )
        assert json.loads(requests[0].content)["provider_extension"] == {"enabled": True}
        assert seen == (
            ["request1", "thinking"] if protocol == "chat" else ["request1", "answer", "preserved"]
        )
