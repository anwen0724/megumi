"""Observe replayable Responses input at the SDK HTTP boundary."""

import json
from copy import deepcopy
from dataclasses import replace

import pytest

from app.ai import (
    AssistantMessage,
    Context,
    ImageContent,
    ResponsesOptions,
    SystemMessage,
    TextContent,
    ThinkingContent,
    ToolCall,
    ToolResultMessage,
    Transcript,
    UserMessage,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("supports_images", [True, False])
async def test_system_and_user_content(provider, responses_harness, supports_images):
    model = replace(
        provider.get_models()[0],
        capabilities=replace(
            provider.get_models()[0].capabilities,
            reasoning=True,
            input_modalities=("text", "image") if supports_images else ("text",),
        ),
    )
    transcript = Transcript(
        messages=[
            SystemMessage(content="Be precise", timestamp=0),
            UserMessage(
                content=[
                    TextContent(text="你好\ud800🌸"),
                    ImageContent(mime_type="image/png", data="aA=="),
                ],
                timestamp=1,
            ),
        ]
    )
    original = deepcopy(transcript)
    async with responses_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete(
            model, transcript, ResponsesOptions(api_key="key", http_client=http)
        )
        assert final.stop_reason == "stop", final.error_message
        assert json.loads(requests[0].content)["input"] == [
            {"role": "developer", "content": "Be precise"},
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "你好🌸"},
                    {
                        "type": "input_image",
                        "image_url": "data:image/png;base64,aA==",
                        "detail": "auto",
                    }
                    if supports_images
                    else {
                        "type": "input_text",
                        "text": "(image omitted: model does not support images)",
                    },
                ],
            },
        ]
    assert transcript == original


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["same", "other"])
async def test_assistant_signatures_are_replayed_only_for_same_source(
    provider, responses_harness, source
):
    reasoning = {
        "type": "reasoning",
        "id": "rs_saved",
        "summary": [{"type": "summary_text", "text": "why"}],
        "encrypted_content": "opaque",
    }
    saved = AssistantMessage(
        provider="sample" if source == "same" else "other",
        api="openai-responses",
        model="small",
        timestamp=0,
        stop_reason="stop",
        content=[
            ThinkingContent(thinking="why", thinking_signature=json.dumps(reasoning)),
            TextContent(
                text="answer", text_signature='{"v":1,"id":"msg_saved","phase":"final_answer"}'
            ),
            TextContent(text="legacy", text_signature="msg_legacy"),
        ],
    )
    original = deepcopy(saved)
    async with responses_harness() as (models, http, requests):
        final = await models.complete(
            provider.get_models()[0],
            Context(messages=[saved]),
            ResponsesOptions(api_key="key", http_client=http),
        )
        assert final.stop_reason == "stop", final.error_message
        items = json.loads(requests[0].content)["input"]
        if source == "same":
            assert items[0] == reasoning
            assert items[1]["id"] == "msg_saved" and items[1]["phase"] == "final_answer"
            assert items[2]["id"] == "msg_legacy"
        else:
            assert [item["content"][0]["text"] for item in items] == ["why", "answer", "legacy"]
            assert [item["id"] for item in items] == ["msg_pi_0", "msg_pi_0_1", "msg_pi_0_2"]
            assert all("phase" not in item for item in items)
    assert saved == original


@pytest.mark.asyncio
@pytest.mark.parametrize("source_model", ["small", "other-model"])
async def test_tool_call_identity_namespace_and_inline_result(
    provider, responses_harness, source_model
):
    model = replace(
        provider.get_models()[0],
        provider="openai",
        capabilities=replace(
            provider.get_models()[0].capabilities, input_modalities=("text", "image")
        ),
    )
    source = replace(provider, id="openai", models=[model])
    messages = [
        AssistantMessage(
            provider="openai",
            api="openai-responses",
            model=source_model,
            timestamp=0,
            stop_reason="tool_use",
            content=[
                ToolCall(id="call_1|fc_1", name="inspect", arguments={"x": 1}, namespace="local")
            ],
        ),
        ToolResultMessage(
            tool_call_id="call_1|fc_1",
            tool_name="inspect",
            timestamp=1,
            is_error=False,
            content=[TextContent(text="view"), ImageContent(mime_type="image/png", data="aA==")],
        ),
    ]
    original = deepcopy(messages)
    async with responses_harness(providers=[source]) as (models, http, requests):
        final = await models.complete(
            model, Context(messages=messages), ResponsesOptions(api_key="key", http_client=http)
        )
        assert final.stop_reason == "stop", final.error_message
        call, output = json.loads(requests[0].content)["input"]
        expected = {
            "type": "function_call",
            "call_id": "call_1",
            "name": "inspect",
            "arguments": '{"x":1}',
        }
        if source_model == "small":
            expected.update(id="fc_1", namespace="local")
        assert call == expected
        assert output == {
            "type": "function_call_output",
            "call_id": "call_1",
            "output": [
                {"type": "input_text", "text": "view"},
                {
                    "type": "input_image",
                    "image_url": "data:image/png;base64,aA==",
                    "detail": "auto",
                },
            ],
        }
    assert messages == original


@pytest.mark.asyncio
@pytest.mark.parametrize("preserve", [True, False])
async def test_system_updates_preserve_position_only_when_supported(
    provider, responses_harness, preserve
):
    model = replace(
        provider.get_models()[0],
        compat=replace(
            provider.get_models()[0].compat, supports_mid_convo_system_messages=preserve
        ),
    )
    history = Transcript(
        messages=[
            SystemMessage(content="first", timestamp=0),
            UserMessage(content="hi", timestamp=1),
            SystemMessage(content="second", timestamp=2),
        ]
    )
    async with responses_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        await models.complete(model, history, ResponsesOptions(api_key="key", http_client=http))
        items = json.loads(requests[0].content)["input"]
        assert [item["role"] for item in items] == (
            ["system", "user", "system"] if preserve else ["system", "user"]
        )
        assert items[0]["content"] == ("first" if preserve else "first\n\nsecond")


@pytest.mark.asyncio
async def test_foreign_tool_ids_and_empty_output(provider, responses_harness):
    history = Context(
        messages=[
            AssistantMessage(
                provider="foreign",
                api="openai-completions",
                model="other",
                timestamp=0,
                stop_reason="tool_use",
                content=[ToolCall(id="call.1|item.1", name="inspect", arguments={})],
            ),
            ToolResultMessage(
                tool_call_id="call.1|item.1",
                tool_name="inspect",
                content=[],
                timestamp=1,
                is_error=False,
            ),
        ]
    )
    async with responses_harness() as (models, http, requests):
        final = await models.complete(
            provider.get_models()[0], history, ResponsesOptions(api_key="key", http_client=http)
        )
        assert final.stop_reason == "stop", final.error_message
        call, result = json.loads(requests[0].content)["input"]
        assert call["call_id"] == result["call_id"] == "call_1_item_1"
        assert "id" not in call and "namespace" not in call
        assert result["output"] == "(no tool output)"


@pytest.mark.asyncio
async def test_empty_unrepresentable_messages_do_not_consume_fallback_item_identity(
    provider, responses_harness
):
    messages = [
        UserMessage(content=[], timestamp=0),
        AssistantMessage(
            provider="sample", api="openai-responses", model="small", timestamp=1, content=[]
        ),
        AssistantMessage(
            provider="sample",
            api="openai-responses",
            model="small",
            timestamp=2,
            content=[TextContent(text="visible")],
        ),
    ]
    async with responses_harness() as (models, http, requests):
        final = await models.complete(
            provider.get_models()[0],
            Context(messages=messages),
            ResponsesOptions(api_key="key", http_client=http),
        )
        assert final.stop_reason == "stop", final.error_message
        items = json.loads(requests[0].content)["input"]
        assert len(items) == 1 and items[0]["id"] == "msg_pi_0"
