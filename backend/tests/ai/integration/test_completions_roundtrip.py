"""Exercise persisted history, progress frames and configuration snapshots end to end."""

import asyncio
import json
from dataclasses import replace

import httpx2
import pytest

from app.ai import (
    AssistantMessageFrameEncoder,
    CompletionsOptions,
    Context,
    ModelCompat,
    TextContent,
    ToolResultMessage,
    UserMessage,
    decode_messages,
    deepseek_provider,
    encode_messages,
    reduce_assistant_message_frames,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("same_source", [True, False])
async def test_saved_tool_turn_replays_and_frames_survive_delayed_consumption(
    sdk_harness, native_sse, same_source
):
    provider = deepseek_provider()
    model = provider.models[0]
    first_data = native_sse(
        {"id": "r1", "choices": [{"delta": {"reasoning_content": "Check"}}]},
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_1",
                                "function": {"name": "lookup", "arguments": '{"q":"test"}'},
                            }
                        ]
                    },
                    "finish_reason": "tool_calls",
                }
            ]
        },
    )
    requests = []

    async def handler(request):
        requests.append(json.loads(request.content))
        return httpx2.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=first_data
            if len(requests) == 1
            else native_sse(
                {"choices": [{"delta": {"content": "Found"}, "finish_reason": "stop"}]}
            ),
        )

    async with sdk_harness(providers=[provider], handler=handler) as (models, http, _):
        context = Context(messages=[UserMessage(content="Look up test", timestamp=0)])
        options = CompletionsOptions(api_key="key", http_client=http)
        response = models.stream(model, context, options)
        # Let result settle before consuming progress. Frames must tolerate the advanced partial.
        first = await response.result()
        assert first.stop_reason == "tool_use", first.error_message
        encoder = AssistantMessageFrameEncoder()
        frames = []
        async for event in response:
            frame = encoder.encode(event)
            if frame is not None:
                frames.append(frame)
        restored = reduce_assistant_message_frames(frames)
        assert restored.content == first.content
        assert restored.stop_reason == "pending"
        saved = decode_messages(encode_messages([*context.messages, first]))
        if not same_source:
            saved[-1].provider = "previous-provider"
        saved.append(
            ToolResultMessage(
                tool_call_id="call_1",
                tool_name="lookup",
                content=[TextContent(text="result")],
                is_error=False,
                timestamp=1,
            )
        )
        second = await models.complete(model, Context(messages=saved), options)
        assert second.stop_reason == "stop", second.error_message
        replay = requests[1]["messages"]
        assert replay[1]["reasoning_content"] == ("Check" if same_source else "")
        assert replay[1]["content"] == (None if same_source else "Check")
        assert replay[1]["tool_calls"][0]["id"] == "call_1"
        assert replay[2] == {"role": "tool", "content": "result", "tool_call_id": "call_1"}
        assert json.loads(encode_messages([first]))[0]["stop_reason"] == "tool_use"


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
                {"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]}
            ),
        )

    async with sdk_harness(handler=handler) as (models, http, _):
        context = Context(messages=[UserMessage(content="old", timestamp=0)])
        sampling = {"top_p": 0.2}
        first = models.stream(
            provider.models[0],
            context,
            CompletionsOptions(api_key="old-key", http_client=http, sampling_params=sampling),
        )
        await asyncio.wait_for(entered.wait(), 1)
        context.messages[0].content = "new"
        sampling["top_p"] = 0.9
        new_model = replace(
            provider.models[0],
            sampling_params={"top_p": 0.7},
            compat=ModelCompat(max_tokens_field="max_tokens"),
        )
        models.set_provider(replace(provider, models=[new_model], base_url="https://new.test/v2"))
        second = await models.complete(
            provider.models[0],
            context,
            CompletionsOptions(api_key="new-key", http_client=http, max_output_tokens=50),
        )
        release.set()
        assert (await first.result()).stop_reason == second.stop_reason == "stop"
        assert bodies[0][0] == "https://example.test/v1/chat/completions"
        assert bodies[0][1] == "Bearer old-key"
        assert bodies[0][2]["messages"] == [{"role": "user", "content": "old"}]
        assert bodies[0][2]["top_p"] == 0.2
        assert bodies[1][0] == "https://new.test/v2/chat/completions"
        assert bodies[1][1] == "Bearer new-key"
        assert bodies[1][2]["messages"] == [{"role": "user", "content": "new"}]
        assert bodies[1][2]["top_p"] == 0.7
        assert bodies[1][2]["max_tokens"] == 50
