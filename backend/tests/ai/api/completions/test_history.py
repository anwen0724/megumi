"""Observe replay conversion in the actual outgoing SDK request."""

import json
from copy import deepcopy
from dataclasses import replace

import pytest

from app.ai import (
    AssistantMessage,
    CompletionsOptions,
    Context,
    ImageContent,
    ModelCapabilities,
    ModelCompat,
    SystemMessage,
    TextContent,
    ThinkingContent,
    ToolCall,
    ToolResultMessage,
    Transcript,
    UserMessage,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("preserve", [False, True])
async def test_system_updates_and_user_parts(provider, sdk_harness, preserve):
    model = replace(
        provider.models[0],
        capabilities=ModelCapabilities(reasoning=True, input_modalities=("text", "image")),
        compat=ModelCompat(supports_mid_convo_system_messages=preserve),
    )
    provider = replace(provider, models=[model])
    history = Transcript(
        messages=[
            SystemMessage(content="Base", sections={"a": "Old"}, timestamp=0),
            UserMessage(
                content=[TextContent(text="Hi"), ImageContent(mime_type="image/png", data="AA==")],
                timestamp=1,
            ),
            SystemMessage(content="", sections={"a": "New"}, timestamp=2),
        ]
    )
    original = deepcopy(history)
    async with sdk_harness(providers=[provider]) as (models, http, requests):
        final = await models.complete(
            model, history, CompletionsOptions(api_key="key", http_client=http)
        )
        assert final.stop_reason == "stop", final.error_message
        messages = json.loads(requests[0].content)["messages"]
        assert messages[0] == {
            "role": "developer",
            "content": "Base\n\nOld" if preserve else "Base\n\nNew",
        }
        assert messages[1] == {
            "role": "user",
            "content": [
                {"type": "text", "text": "Hi"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}},
            ],
        }
        if preserve:
            assert messages[2] == {
                "role": "developer",
                "content": 'Updated system prompt section "a":\n\nNew',
            }
        else:
            assert len(messages) == 2
    assert history == original


@pytest.mark.asyncio
@pytest.mark.parametrize("same", [True, False])
async def test_assistant_replay_repairs_missing_tool_result_and_cleans_private_reasoning(
    provider, sdk_harness, same
):
    assistant = AssistantMessage(
        provider="sample" if same else "other",
        api="openai-completions",
        model="small",
        timestamp=0,
        stop_reason="tool_use",
        content=[
            ThinkingContent(thinking="Plan", thinking_signature="reasoning_content"),
            TextContent(text="Working"),
            ToolCall(id="call_1", name="lookup", arguments={"q": "x"}),
        ],
    )
    failed = replace(assistant, stop_reason="error", content=[TextContent(text="discard")])
    history = Context(messages=[assistant, UserMessage(content="continue", timestamp=1), failed])
    original = deepcopy(history)
    async with sdk_harness() as (models, http, requests):
        final = await models.complete(
            provider.models[0], history, CompletionsOptions(api_key="key", http_client=http)
        )
        assert final.stop_reason == "stop", final.error_message
        messages = json.loads(requests[0].content)["messages"]
        assert messages[0]["content"] == ("Working" if same else "PlanWorking")
        assert messages[0].get("reasoning_content") == ("Plan" if same else None)
        assert messages[0]["tool_calls"] == [
            {
                "id": "call_1",
                "type": "function",
                "function": {"name": "lookup", "arguments": '{"q":"x"}'},
            }
        ]
        assert messages[1] == {
            "role": "tool",
            "tool_call_id": "call_1",
            "content": "No result provided",
        }
        assert messages[2] == {"role": "user", "content": "continue"}
        assert len(messages) == 3
    assert history == original


@pytest.mark.asyncio
@pytest.mark.parametrize("vision", [True, False])
async def test_tool_images_follow_consecutive_results_and_empty_messages_are_skipped(
    provider, sdk_harness, vision
):
    model = replace(
        provider.models[0],
        capabilities=ModelCapabilities(input_modalities=("text", "image") if vision else ("text",)),
    )
    provider = replace(provider, models=[model])
    image = ImageContent(mime_type="image/png", data="AA==")
    history = Context(
        messages=[
            UserMessage(content=[], timestamp=0),
            AssistantMessage(
                provider="sample", api=model.api, model=model.id, content=[], timestamp=0
            ),
            ToolResultMessage(
                tool_call_id="a", tool_name="a", content=[image], is_error=False, timestamp=1
            ),
            ToolResultMessage(
                tool_call_id="b", tool_name="b", content=[], is_error=False, timestamp=2
            ),
            UserMessage(content="A\ud800😀\ud83d\ude00B\udc00", timestamp=3),
        ]
    )
    async with sdk_harness(providers=[provider]) as (models, http, requests):
        final = await models.complete(
            model, history, CompletionsOptions(api_key="key", http_client=http)
        )
        assert final.stop_reason == "stop", final.error_message
        messages = json.loads(requests[0].content)["messages"]
        assert messages[0] == {
            "role": "tool",
            "tool_call_id": "a",
            "content": "(see attached image)"
            if vision
            else "(tool image omitted: model does not support images)",
        }
        assert messages[1] == {"role": "tool", "tool_call_id": "b", "content": "(no tool output)"}
        if vision:
            assert messages[2] == {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Attached image(s) from tool result:"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}},
                ],
            }
        assert messages[-1] == {"role": "user", "content": "A😀😀B"}


@pytest.mark.asyncio
async def test_responses_ids_normalize_calls_and_results(provider, sdk_harness):
    ids = ["call/x|item+1", "call_x|" + "i" * 60, "call_x|" + "j" * 60]
    assistant = AssistantMessage(
        provider="other",
        api="openai-responses",
        model="other",
        timestamp=0,
        stop_reason="tool_use",
        content=[ToolCall(id=value, name="lookup", arguments={}) for value in ids],
    )
    async with sdk_harness() as (models, http, requests):
        final = await models.complete(
            provider.models[0],
            Context(messages=[assistant]),
            CompletionsOptions(api_key="key", http_client=http),
        )
        assert final.stop_reason == "stop", final.error_message
        messages = json.loads(requests[0].content)["messages"]
        actual = [call["id"] for call in messages[0]["tool_calls"]]
        assert actual == ["call_x_item_1", "call_x_1fyb4pz1", "call_x_bg66u41t"]
        assert all(len(value) <= 40 for value in actual)
        assert len(set(actual)) == 3
        assert [m["tool_call_id"] for m in messages[1:]] == actual
        assert [call.id for call in assistant.content] == ids


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy", [False, True])
async def test_structured_reasoning_replay_avoids_duplicate_raw_reasoning(
    provider, sdk_harness, legacy
):
    detail = {"type": "reasoning.encrypted", "id": "r", "data": "opaque"}
    assistant = AssistantMessage(
        provider="sample",
        api="openai-completions",
        model="small",
        timestamp=0,
        stop_reason="tool_use",
        content=[
            ThinkingContent(
                thinking="plan",
                thinking_signature="reasoning_content" if legacy else json.dumps([detail]),
            ),
            ToolCall(
                id="c",
                name="lookup",
                arguments={},
                thought_signature=json.dumps(detail) if legacy else None,
            ),
        ],
    )
    async with sdk_harness() as (models, http, requests):
        final = await models.complete(
            provider.models[0],
            Context(messages=[assistant]),
            CompletionsOptions(api_key="key", http_client=http),
        )
        assert final.stop_reason == "stop", final.error_message
        replay = json.loads(requests[0].content)["messages"][0]
        assert replay["reasoning_details"] == [detail]
        assert "reasoning_content" not in replay
