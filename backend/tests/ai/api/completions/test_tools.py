"""Check tool declarations through outgoing requests, never private schema helpers."""

import json
from dataclasses import replace

import pytest

from app.ai import (
    AssistantMessage,
    CompletionsOptions,
    Context,
    JsonSchemaSampling,
    ModelCompat,
    SystemMessage,
    Tool,
    ToolCall,
    Transcript,
    UserMessage,
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode,support,convertible",
    [
        (None, True, True),
        ("prefer", True, True),
        ("require", True, True),
        ("prefer", False, True),
        ("prefer", None, True),
        ("require", None, True),
        (None, None, True),
        ("require", False, True),
        ("prefer", True, False),
        ("require", True, False),
    ],
)
async def test_function_strict_policy(provider, sdk_harness, mode, support, convertible):
    model = replace(provider.get_models()[0], compat=ModelCompat(supports_strict_mode=support))
    schema = {"type": "object", "properties": {"q": {"type": "string"}}}
    if not convertible:
        schema["additionalProperties"] = True
    tool = Tool(
        name="lookup",
        description="Find",
        parameters=schema,
        constrained_sampling=JsonSchemaSampling(strict=mode) if mode else None,
    )
    async with sdk_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete(
            model,
            Context(messages=[], tools=[tool]),
            CompletionsOptions(api_key="key", http_client=http),
        )
        if mode == "require" and not (support and convertible):
            assert final.stop_reason == "error"
            assert not requests
            return
        assert final.stop_reason == "stop", final.error_message
        function = json.loads(requests[0].content)["tools"][0]["function"]
        assert function["name"] == "lookup"
        assert function["description"] == "Find"
        if support:
            assert function["strict"] is bool(mode and convertible)
        else:
            assert "strict" not in function
        expected = (
            {
                "type": "object",
                "properties": {"q": {"anyOf": [{"type": "string"}, {"type": "null"}]}},
                "required": ["q"],
                "additionalProperties": False,
            }
            if mode and support and convertible
            else schema
        )
        assert function["parameters"] == expected


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change,preserve", [("add", True), ("add", False), ("replace", True), ("remove", True)]
)
async def test_mid_conversation_tool_changes(provider, sdk_harness, change, preserve):
    first = Tool(name="a", description="old", parameters={"type": "object"})
    second = Tool(
        name="a" if change == "replace" else "b", description="new", parameters={"type": "object"}
    )
    update = SystemMessage(
        content="",
        timestamp=2,
        tools_added=None if change == "remove" else [second],
        tools_removed=["a"] if change == "remove" else None,
    )
    model = replace(
        provider.get_models()[0],
        compat=ModelCompat(
            supports_mid_convo_system_messages=preserve, supports_mid_convo_tool_additions=preserve
        ),
    )
    history = Transcript(
        messages=[
            SystemMessage(content="", timestamp=0, tools_added=[first]),
            UserMessage(content="hi", timestamp=1),
            update,
        ]
    )
    async with sdk_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete(
            model, history, CompletionsOptions(api_key="key", http_client=http)
        )
        assert final.stop_reason == "stop", final.error_message
        payload = json.loads(requests[0].content)
        tools = payload.get("tools", [])
        assert [t["function"]["name"] for t in tools] == (
            [] if change == "remove" else ["a"] if preserve else ["a", "b"]
        )
        if change == "add" and preserve:
            assert payload["messages"][-1]["role"] == "system"
            assert payload["messages"][-1]["tools"][0]["function"]["name"] == "b"
        elif change == "replace":
            assert tools[0]["function"]["description"] == "new"


@pytest.mark.asyncio
async def test_empty_tools_only_when_tool_history_exists(provider, sdk_harness):
    assistant = AssistantMessage(
        provider="sample",
        api="openai-completions",
        model="small",
        timestamp=0,
        stop_reason="tool_use",
        content=[ToolCall(id="c", name="a", arguments={})],
    )
    async with sdk_harness() as (models, http, requests):
        for messages in ([], [assistant]):
            await models.complete(
                provider.get_models()[0],
                Context(messages=messages),
                CompletionsOptions(api_key="key", http_client=http),
            )
        assert "tools" not in json.loads(requests[0].content)
        assert json.loads(requests[1].content)["tools"] == []
