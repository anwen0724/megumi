"""Exchange actual generated history between both builtin protocol adapters."""

import json
from dataclasses import replace

import httpx2
import pytest

from app.ai import (
    Context,
    SimpleOptions,
    TextContent,
    ToolCall,
    ToolResultMessage,
    decode_messages,
    encode_messages,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("first_api", ["openai-completions", "openai-responses"])
async def test_protocols_share_models_and_convert_saved_history(
    provider, sdk_harness, native_sse, first_api
):
    cp = replace(provider.models[0], id="cp", api="openai-completions")
    rp = replace(provider.models[0], id="rp", api="openai-responses")
    configured = replace(provider, api=("openai-completions", "openai-responses"), models=[cp, rp])
    data = {
        "openai-completions": native_sse(
            {"choices": [{"delta": {"reasoning_content": "why"}}]},
            {
                "choices": [
                    {
                        "delta": {
                            "content": "hello",
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_1",
                                    "function": {"name": "lookup", "arguments": "{}"},
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            },
        ),
        "openai-responses": native_sse(
            {
                "type": "response.output_item.done",
                "output_index": 0,
                "item": {
                    "type": "reasoning",
                    "id": "rs",
                    "summary": [{"type": "summary_text", "text": "why"}],
                    "encrypted_content": "opaque",
                },
            },
            {
                "type": "response.output_item.done",
                "output_index": 1,
                "item": {
                    "type": "message",
                    "id": "msg_1",
                    "phase": "commentary",
                    "content": [{"type": "output_text", "text": "hello", "annotations": []}],
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
                    "arguments": "{}",
                    "namespace": "local",
                },
            },
            {"type": "response.completed", "response": {"status": "completed", "output": []}},
        ),
    }

    async def handler(request):
        api = (
            "openai-responses" if request.url.path.endswith("/responses") else "openai-completions"
        )
        return httpx2.Response(
            200, headers={"content-type": "text/event-stream"}, content=data[api]
        )

    async with sdk_harness(providers=[configured], handler=handler) as (models, http, requests):
        first_model, second_model = (cp, rp) if first_api == "openai-completions" else (rp, cp)
        options = SimpleOptions(api_key="key", http_client=http)
        first = await models.complete_simple(first_model, Context(messages=[]), options)
        assert first.stop_reason == "tool_use", first.error_message
        saved = decode_messages(encode_messages([first]))
        call = next(b for b in first.content if isinstance(b, ToolCall))
        saved.append(
            ToolResultMessage(
                tool_call_id=call.id,
                tool_name=call.name,
                content=[TextContent(text="result")],
                timestamp=1,
                is_error=False,
            )
        )
        original = encode_messages(saved)
        second = await models.complete_simple(second_model, Context(messages=saved), options)
        assert second.stop_reason == "tool_use", second.error_message
        assert encode_messages(saved) == original
        wire = json.loads(requests[1].content)
        assert "opaque" not in requests[1].content.decode()
        if first_api == "openai-completions":
            items = wire["input"]
            assert [i["content"][0]["text"] for i in items[:2]] == ["why", "hello"]
            assert all("phase" not in i for i in items)
            assert items[2] == {
                "type": "function_call",
                "call_id": "call_1",
                "name": "lookup",
                "arguments": "{}",
            }
            assert items[3] == {
                "type": "function_call_output",
                "call_id": "call_1",
                "output": "result",
            }
        else:
            assistant, output = wire["messages"]
            assert assistant["content"] == "whyhello"
            assert "reasoning_content" not in assistant and "reasoning_details" not in assistant
            assert assistant["tool_calls"][0]["id"] == "call_1_fc_1"
            assert output == {"role": "tool", "tool_call_id": "call_1_fc_1", "content": "result"}
