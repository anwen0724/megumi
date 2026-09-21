"""Exercise builtin protocol dispatch through the SDK and the external HTTP boundary."""

import json

import httpx2
import pytest

from app.ai import Context, Models, SimpleOptions, TextContent, UserMessage


@pytest.mark.asyncio
async def test_builtin_text_call_uses_sdk_and_emits_one_final(provider):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx2.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=(
                'data: {"id":"r1","model":"small","choices":[{'
                '"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n'
                'data: {"id":"r1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
                "data: [DONE]\n\n"
            ),
        )

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(respond)) as http:
        models = Models([provider])
        response = models.stream_simple(
            provider.models[0],
            Context(messages=[UserMessage(content="Hi", timestamp=0)]),
            SimpleOptions(api_key="test-key", http_client=http),
        )
        events = [event async for event in response]
        final = await response.result()
        await models.aclose()
    assert final.stop_reason == "stop", final.error_message
    assert final.content == [TextContent(text="Hello")]
    assert [event["type"] for event in events] == [
        "start",
        "text_start",
        "text_delta",
        "text_end",
        "done",
    ]
    assert events[-1]["message"] is final
    assert str(requests[0].url) == "https://example.test/v1/chat/completions"
    payload = json.loads(requests[0].content)
    assert payload["model"] == "small"
    assert payload["messages"] == [{"role": "user", "content": "Hi"}]
    assert payload["stream"] is True
    assert requests[0].headers["authorization"] == "Bearer test-key"


@pytest.mark.asyncio
@pytest.mark.parametrize("entry", ["stream", "stream_simple", "complete", "complete_simple"])
async def test_all_entries_preserve_catalog_identity_and_actual_model(
    provider, sdk_harness, native_sse, entry
):
    from app.ai import CompletionsOptions

    data = native_sse(
        {
            "id": "response-1",
            "model": "small-actual",
            "choices": [{"delta": {"content": "answer"}, "finish_reason": "stop"}],
        }
    )
    async with sdk_harness(data=data) as (models, http, _):
        options = (SimpleOptions if entry.endswith("simple") else CompletionsOptions)(
            api_key="key", http_client=http
        )
        response = getattr(models, entry)(provider.models[0], Context(messages=[]), options)
        final = await response if entry.startswith("complete") else await response.result()
        assert (final.provider, final.api, final.model) == ("sample", "openai-completions", "small")
        assert (final.response_id, final.response_model) == ("response-1", "small-actual")
        assert final.stop_reason == "stop"


@pytest.mark.asyncio
async def test_missing_finish_is_error_with_partial_content(provider, sdk_harness, native_sse):
    data = native_sse({"choices": [{"delta": {"content": "unfinished"}, "finish_reason": None}]})
    async with sdk_harness(data=data) as (models, http, _):
        response = models.stream_simple(
            provider.models[0], Context(messages=[]), SimpleOptions(api_key="key", http_client=http)
        )
        final = await response.result()
        assert final.stop_reason == "error"
        assert "without finish_reason" in final.error_message
        assert final.content == [TextContent(text="unfinished")]
        assert [e["type"] async for e in response].count("error") == 1


@pytest.mark.asyncio
async def test_protocol_shared_by_providers_keeps_auth_endpoints_and_extensions(
    provider, sdk_harness
):
    from dataclasses import replace

    second_model = replace(provider.models[0], provider="second")
    second = replace(
        provider, id="second", models=[second_model], base_url="https://second.test/v2"
    )
    async with sdk_harness(providers=[provider, second]) as (models, http, requests):
        for model, key in [(provider.models[0], "first-key"), (second_model, "second-key")]:
            final = await models.complete_simple(
                model,
                Context(messages=[]),
                SimpleOptions(
                    api_key=key,
                    http_client=http,
                    on_payload=lambda payload, _: {
                        **payload,
                        "vendor_extension": {"enabled": True},
                    },
                ),
            )
            assert final.stop_reason == "stop"
        assert [r.headers["authorization"] for r in requests] == [
            "Bearer first-key",
            "Bearer second-key",
        ]
        assert [r.url.host for r in requests] == ["example.test", "second.test"]
        assert all(json.loads(r.content)["vendor_extension"] == {"enabled": True} for r in requests)
