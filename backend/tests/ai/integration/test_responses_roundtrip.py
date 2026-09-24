"""Save actual Responses results and replay them through another SDK request."""

import asyncio
import json
from dataclasses import replace

import httpx2
import pytest
from pydantic import TypeAdapter

from app.ai import (
    AssistantMessageFrame,
    AssistantMessageFrameEncoder,
    Context,
    ResponsesOptions,
    TextContent,
    ToolResultMessage,
    UserMessage,
    decode_messages,
    encode_messages,
    openai_responses_api,
    reduce_assistant_message_frames,
)


@pytest.fixture
def provider(provider):
    return replace(
        provider,
        api=openai_responses_api(),
        models=[replace(provider.get_models()[0], api="openai-responses")],
    )


@pytest.mark.asyncio
async def test_saved_signed_turn_and_delayed_frames_replay(provider, sdk_harness, native_sse):
    signed = {"type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "opaque"}
    first_data = native_sse(
        {"type": "response.output_item.done", "output_index": 0, "item": signed},
        {
            "type": "response.output_item.done",
            "output_index": 1,
            "item": {
                "type": "message",
                "id": "msg_1",
                "phase": "commentary",
                "content": [{"type": "output_text", "text": "Checking", "annotations": []}],
            },
        },
        {
            "type": "response.output_item.done",
            "output_index": 2,
            "item": {
                "type": "function_call",
                "id": "fc_1",
                "call_id": "call_1",
                "name": "lookup",
                "arguments": '{"q":"test"}',
                "namespace": "local",
            },
        },
        {
            "type": "response.completed",
            "response": {"id": "r1", "status": "completed", "output": []},
        },
    )
    calls = []

    async def handler(request):
        calls.append(json.loads(request.content))
        return httpx2.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=first_data
            if len(calls) == 1
            else native_sse(
                {
                    "type": "response.output_item.done",
                    "output_index": 0,
                    "item": {
                        "type": "message",
                        "id": "msg_2",
                        "phase": "final_answer",
                        "content": [{"type": "output_text", "text": "Found", "annotations": []}],
                    },
                },
                {
                    "type": "response.completed",
                    "response": {"id": "r2", "status": "completed", "output": []},
                },
            ),
        )

    async with sdk_harness(handler=handler) as (models, http, _):
        user = UserMessage(content="Look up test", timestamp=0)
        options = ResponsesOptions(api_key="key", http_client=http)
        response = models.stream(provider.get_models()[0], Context(messages=[user]), options)
        one, two = await asyncio.gather(response.result(), response.result())
        assert one is two and one.stop_reason == "tool_use", one.error_message
        encoder = AssistantMessageFrameEncoder()
        frames = []
        async for event in response:
            frame = encoder.encode(event)
            if frame is not None:
                frames.append(frame)
        adapter = TypeAdapter(list[AssistantMessageFrame])
        restored = reduce_assistant_message_frames(adapter.validate_json(adapter.dump_json(frames)))
        assert restored.content == one.content and restored.stop_reason == "pending"
        saved = decode_messages(encode_messages([user, one]))
        saved.append(
            ToolResultMessage(
                tool_call_id="call_1|fc_1",
                tool_name="lookup",
                content=[TextContent(text="result")],
                is_error=False,
                timestamp=1,
            )
        )
        second = await models.complete(provider.get_models()[0], Context(messages=saved), options)
        assert second.stop_reason == "stop" and second.content[0].text == "Found", (
            second.error_message
        )
        replay = calls[1]["input"]
        assert replay[1] == signed
        assert replay[2]["id"] == "msg_1" and replay[2]["phase"] == "commentary"
        assert replay[3] == {
            "type": "function_call",
            "id": "fc_1",
            "call_id": "call_1",
            "name": "lookup",
            "arguments": '{"q":"test"}',
            "namespace": "local",
        }
        assert replay[4] == {
            "type": "function_call_output",
            "call_id": "call_1",
            "output": "result",
        }
        assert "previous_response_id" not in calls[1]


@pytest.mark.asyncio
async def test_running_call_uses_old_snapshot_and_next_call_uses_replacement(
    provider, sdk_harness, native_sse
):
    entered, release = asyncio.Event(), asyncio.Event()
    bodies = []

    async def handler(request):
        bodies.append(
            (str(request.url), request.headers["authorization"], json.loads(request.content))
        )
        if len(bodies) == 1:
            entered.set()
            await release.wait()
        return httpx2.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=native_sse(
                {"type": "response.completed", "response": {"status": "completed", "output": []}}
            ),
        )

    async with sdk_harness(handler=handler) as (models, http, _):
        context = Context(messages=[UserMessage(content="old", timestamp=0)])
        sampling = {"top_p": 0.2}
        first = models.stream(
            provider.get_models()[0],
            context,
            ResponsesOptions(api_key="old-key", http_client=http, sampling_params=sampling),
        )
        await asyncio.wait_for(entered.wait(), 1)
        context.messages[0].content = "new"
        sampling["top_p"] = 0.9
        new_model = replace(
            provider.get_models()[0],
            sampling_params={"top_p": 0.7},
            compat=replace(provider.get_models()[0].compat, supports_max_output_tokens=True),
        )
        models.set_provider(replace(provider, models=[new_model], base_url="https://new.test/v2"))
        second = await models.complete(
            provider.get_models()[0],
            context,
            ResponsesOptions(api_key="new-key", http_client=http, max_output_tokens=50),
        )
        release.set()
        assert (await first.result()).stop_reason == second.stop_reason == "stop"
        assert bodies[0][0] == "https://example.test/v1/responses"
        assert bodies[0][1] == "Bearer old-key"
        assert bodies[0][2]["input"] == [
            {"role": "user", "content": [{"type": "input_text", "text": "old"}]}
        ]
        assert bodies[0][2]["top_p"] == 0.2
        assert bodies[1][0] == "https://new.test/v2/responses"
        assert bodies[1][1] == "Bearer new-key"
        assert bodies[1][2]["input"] == [
            {"role": "user", "content": [{"type": "input_text", "text": "new"}]}
        ]
        assert bodies[1][2]["top_p"] == 0.7
        assert bodies[1][2]["max_output_tokens"] == 50
