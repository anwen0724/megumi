"""Drive builtin Responses invocation through the actual SDK HTTP boundary."""

import json

import pytest

from app.ai import Context, SimpleOptions, UserMessage


@pytest.mark.asyncio
async def test_builtin_responses_text_call(provider, sdk_harness, response_sse):
    data = response_sse(
        {"type": "response.created", "response": {"id": "resp_1", "model": "small-actual"}},
        {
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {"type": "message", "id": "msg_1", "role": "assistant", "content": []},
        },
        {
            "type": "response.output_text.delta",
            "output_index": 0,
            "item_id": "msg_1",
            "delta": "Hello",
        },
        {
            "type": "response.output_item.done",
            "output_index": 0,
            "item": {
                "type": "message",
                "id": "msg_1",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "Hello", "annotations": []}],
            },
        },
        {
            "type": "response.completed",
            "response": {
                "id": "resp_1",
                "model": "small-actual",
                "status": "completed",
                "output": [],
            },
        },
    )
    async with sdk_harness(data=data) as (models, http, requests):
        response = models.stream_simple(
            provider.models[0],
            Context(messages=[UserMessage(content="Hi", timestamp=0)]),
            SimpleOptions(api_key="key", http_client=http),
        )
        events = [event async for event in response]
        final = await response.result()
        assert final.stop_reason == "stop", final.error_message
        assert final.content[0].text == "Hello"
        assert (final.provider, final.api, final.model) == ("sample", "openai-responses", "small")
        assert (final.response_id, final.response_model) == ("resp_1", "small-actual")
        assert [e["type"] for e in events] == [
            "start",
            "text_start",
            "text_delta",
            "text_end",
            "done",
        ]
        assert str(requests[0].url) == "https://example.test/v1/responses"
        payload = json.loads(requests[0].content)
        assert payload["input"] == [
            {"role": "user", "content": [{"type": "input_text", "text": "Hi"}]}
        ]
        assert payload["model"] == "small"
        assert payload["stream"] is True and payload["store"] is False
        assert "previous_response_id" not in payload


@pytest.mark.asyncio
@pytest.mark.parametrize("entry", ["stream", "stream_simple", "complete", "complete_simple"])
async def test_all_entries_and_two_providers(provider, sdk_harness, response_sse, entry):
    from dataclasses import replace

    from app.ai import ResponsesOptions

    other = replace(
        provider,
        id="other",
        base_url="https://other.test/v2",
        models=[replace(provider.models[0], provider="other")],
    )
    data = response_sse(
        {"type": "response.completed", "response": {"id": "r", "status": "completed", "output": []}}
    )
    async with sdk_harness(providers=[provider, other], data=data) as (models, http, requests):
        for source in (provider, other):
            options = (SimpleOptions if entry.endswith("simple") else ResponsesOptions)(
                api_key=source.id,
                http_client=http,
                on_payload=lambda body, _: {**body, "vendor_extension": {"enabled": True}},
            )
            call = getattr(models, entry)(source.models[0], Context(messages=[]), options)
            final = await call if entry.startswith("complete") else await call.result()
            assert final.stop_reason == "stop", final.error_message
            assert final.provider == source.id
        assert [r.url.host for r in requests] == ["example.test", "other.test"]
        assert [r.headers["authorization"] for r in requests] == ["Bearer sample", "Bearer other"]
        assert all(json.loads(r.content)["vendor_extension"] == {"enabled": True} for r in requests)


@pytest.mark.asyncio
async def test_item_done_without_overall_terminal_is_error(provider, sdk_harness, response_sse):
    data = response_sse({"type": "response.created", "response": {"id": "r"}})
    async with sdk_harness(data=data) as (models, http, _):
        response = models.stream_simple(
            provider.models[0], Context(messages=[]), SimpleOptions(api_key="key", http_client=http)
        )
        final = await response.result()
        assert final.stop_reason == "error"
        assert "terminal" in final.error_message
        assert [e["type"] async for e in response] == ["start", "error"]
