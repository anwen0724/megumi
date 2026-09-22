"""Check tool declarations through outgoing requests, never private schema helpers."""

import json
from dataclasses import replace

import pytest

from app.ai import (
    Context,
    JsonSchemaSampling,
    ModelCompat,
    ResponsesOptions,
    SystemMessage,
    ToolDefinition,
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
        ("require", False, True),
        ("prefer", True, False),
        ("require", True, False),
    ],
)
async def test_function_strict_policy(provider, responses_harness, mode, support, convertible):
    model = replace(provider.models[0], compat=ModelCompat(supports_strict_mode=support))
    schema = {"type": "object", "properties": {"q": {"type": "string"}}}
    if not convertible:
        schema["additionalProperties"] = True
    tool = ToolDefinition(
        name="lookup",
        description="Find",
        parameters=schema,
        constrained_sampling=JsonSchemaSampling(strict=mode) if mode else None,
    )
    async with responses_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete(
            model,
            Context(messages=[], tools=[tool]),
            ResponsesOptions(api_key="key", http_client=http),
        )
        if mode == "require" and not (support and convertible):
            assert final.stop_reason == "error"
            assert not requests
            return
        assert final.stop_reason == "stop", final.error_message
        function = json.loads(requests[0].content)["tools"][0]
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
    "mode,change",
    [
        ("additional", "add"),
        ("search", "add"),
        ("fold", "add"),
        ("additional", "replace"),
        ("search", "remove"),
    ],
)
async def test_tool_changes_follow_declared_wire_capability(
    provider, responses_harness, mode, change
):
    first = ToolDefinition(name="a", description="old", parameters={"type": "object"})
    second = ToolDefinition(
        name="a" if change == "replace" else "b", description="new", parameters={"type": "object"}
    )
    model = replace(
        provider.models[0],
        compat=ModelCompat(
            supports_mid_convo_system_messages=True,
            supports_additional_tools=mode == "additional",
            supports_tool_search=mode == "search",
        ),
    )
    history = Transcript(
        messages=[
            SystemMessage(content="", timestamp=0, tools_added=[first]),
            UserMessage(content="hi", timestamp=1),
            SystemMessage(
                content="",
                timestamp=2,
                tools_added=None if change == "remove" else [second],
                tools_removed=["a"] if change == "remove" else None,
            ),
        ]
    )
    async with responses_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete(
            model, history, ResponsesOptions(api_key="key", http_client=http)
        )
        assert final.stop_reason == "stop", final.error_message
        body = json.loads(requests[0].content)
        names = [t["name"] for t in body.get("tools", [])]
        assert names == ([] if change == "remove" else ["a", "b"] if mode == "fold" else ["a"])
        if change != "add" or mode == "fold":
            assert len(body["input"]) == 1
            if change == "replace":
                assert body["tools"][0]["description"] == "new"
        elif mode == "additional":
            assert body["input"][1] == {
                "type": "additional_tools",
                "role": "developer",
                "tools": [
                    {
                        "type": "function",
                        "name": "b",
                        "description": "new",
                        "parameters": {"type": "object"},
                    }
                ],
            }
        else:
            call, output = body["input"][1:]
            assert call["type"] == "tool_search_call" and call["arguments"] == {
                "query": "b",
                "limit": 1,
            }
            assert output["type"] == "tool_search_output"
            assert call["call_id"] == output["call_id"]
            assert call["call_id"].startswith("megumi_tool_load_")
            assert call["execution"] == output["execution"] == "client"
            assert call["status"] == output["status"] == "completed"
            assert output["tools"][0]["defer_loading"] is True
            assert output["tools"][0]["name"] == "b"
