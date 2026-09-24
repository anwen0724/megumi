"""Native multi-item event traces observed through Models and shared events."""

import json

import pytest

from app.ai import Context, ResponsesOptions


def item_event(kind, index, item):
    return {"type": "response.output_item." + kind, "output_index": index, "item": item}


def terminal(status="completed", **fields):
    return {
        "type": "response." + status,
        "response": {"id": "r", "status": status, "output": [], **fields},
    }


def message(identity, text, phase=None):
    item = {
        "type": "message",
        "id": identity,
        "role": "assistant",
        "status": "completed",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    }
    if phase:
        item["phase"] = phase
    return item


@pytest.mark.asyncio
async def test_interleaved_text_refusal_and_done_only(provider, sdk_harness, response_sse):
    data = response_sse(
        item_event("added", 3, message("msg_a", "")),
        item_event("added", 8, message("msg_b", "")),
        {
            "type": "response.output_text.delta",
            "output_index": 3,
            "item_id": "msg_a",
            "delta": "draft",
        },
        {
            "type": "response.refusal.delta",
            "output_index": 8,
            "item_id": "msg_b",
            "delta": "cannot",
        },
        {
            "type": "response.refusal.done",
            "output_index": 8,
            "item_id": "msg_b",
            "refusal": "cannot comply",
        },
        item_event("done", 3, message("msg_a", "corrected", "commentary")),
        item_event(
            "done",
            8,
            {
                "type": "message",
                "id": "msg_b",
                "content": [{"type": "refusal", "refusal": "cannot comply"}],
            },
        ),
        item_event("done", 9, message("msg_c", "done only", "final_answer")),
        terminal(),
    )
    async with sdk_harness(data=data) as (models, http, _):
        response = models.stream(
            provider.get_models()[0],
            Context(messages=[]),
            ResponsesOptions(api_key="key", http_client=http),
        )
        events = [e async for e in response]
        final = await response.result()
        assert final.stop_reason == "stop", final.error_message
        assert [b.text for b in final.content] == ["corrected", "cannot comply", "done only"]
        assert [(e["content_index"], e["delta"]) for e in events if e["type"] == "text_delta"] == [
            (0, "draft"),
            (1, "cannot"),
        ]
        assert [(e["content_index"], e["content"]) for e in events if e["type"] == "text_end"] == [
            (0, "corrected"),
            (1, "cannot comply"),
            (2, "done only"),
        ]
        assert json.loads(final.content[0].text_signature) == {
            "v": 1,
            "id": "msg_a",
            "phase": "commentary",
        }
        assert json.loads(final.content[2].text_signature) == {
            "v": 1,
            "id": "msg_c",
            "phase": "final_answer",
        }


@pytest.mark.asyncio
async def test_reasoning_items_preserve_visible_summary_and_opaque_signature(
    provider, sdk_harness, response_sse
):
    signed = {
        "type": "reasoning",
        "id": "rs_1",
        "summary": [{"type": "summary_text", "text": "corrected"}],
        "encrypted_content": "opaque",
        "vendor_field": {"x": 1},
    }
    hidden = {"type": "reasoning", "id": "rs_2", "summary": [], "encrypted_content": "hidden-only"}
    data = response_sse(
        item_event("added", 0, {"type": "reasoning", "id": "rs_1", "summary": []}),
        {"type": "response.reasoning_summary_text.delta", "output_index": 0, "delta": "first"},
        {
            "type": "response.reasoning_summary_part.done",
            "output_index": 0,
            "part": {"type": "summary_text", "text": "first"},
        },
        {"type": "response.reasoning_text.delta", "output_index": 0, "delta": "second"},
        item_event("done", 0, signed),
        item_event("done", 1, hidden),
        terminal(),
    )
    async with sdk_harness(data=data) as (models, http, _):
        response = models.stream(
            provider.get_models()[0],
            Context(messages=[]),
            ResponsesOptions(api_key="key", http_client=http),
        )
        events = [e async for e in response]
        final = await response.result()
        assert final.stop_reason == "stop", final.error_message
        assert [b.thinking for b in final.content] == ["corrected", ""]
        assert [e["delta"] for e in events if e["type"] == "thinking_delta"] == [
            "first",
            "\n\n",
            "second",
        ]
        assert json.loads(final.content[0].thinking_signature) == signed
        assert json.loads(final.content[1].thinking_signature) == hidden


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "done_arguments,expected_deltas",
    [
        ('{"city":"北京"}', ['{"city":', '"北京"}']),
        ('{"city":2}', ['{"city":', "2}"]),
        ("[]", ['{"city":']),
    ],
)
async def test_parallel_function_arguments_done_is_authoritative(
    provider, sdk_harness, response_sse, done_arguments, expected_deltas
):
    first = {
        "type": "function_call",
        "id": "fc_a",
        "call_id": "call_a",
        "name": "lookup",
        "arguments": "",
        "namespace": "local",
    }
    second = {
        "type": "function_call",
        "id": "fc_b",
        "call_id": "call_b",
        "name": "lookup",
        "arguments": "",
    }
    data = response_sse(
        item_event("added", 4, first),
        item_event("added", 6, second),
        {"type": "response.function_call_arguments.delta", "output_index": 4, "delta": '{"city":'},
        {"type": "response.function_call_arguments.delta", "output_index": 6, "delta": '{"x":1'},
        {
            "type": "response.function_call_arguments.done",
            "output_index": 4,
            "arguments": done_arguments,
        },
        {
            "type": "response.function_call_arguments.done",
            "output_index": 4,
            "arguments": done_arguments,
        },
        item_event("done", 6, {**second, "arguments": '{"x":1}'}),
        item_event("done", 4, {**first, "arguments": done_arguments}),
        terminal(),
    )
    async with sdk_harness(data=data) as (models, http, _):
        response = models.stream(
            provider.get_models()[0],
            Context(messages=[]),
            ResponsesOptions(api_key="key", http_client=http),
        )
        events = [e async for e in response]
        final = await response.result()
        assert final.stop_reason in ("stop", "tool_use"), final.error_message
        assert len(final.content) == 2
        assert final.content[0].id == "call_a|fc_a" and final.content[0].namespace == "local"
        assert final.content[0].arguments == json.loads(done_arguments)
        assert final.content[1].arguments == {"x": 1}
        assert [
            e["delta"] for e in events if e["type"] == "toolcall_delta" and e["content_index"] == 0
        ] == expected_deltas
        assert [e["content_index"] for e in events if e["type"] == "toolcall_end"] == [1, 0]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "event,expected,raw",
    [
        (terminal(), "stop", "completed"),
        (
            terminal("incomplete", incomplete_details={"reason": "max_output_tokens"}),
            "length",
            "incomplete.max_output_tokens",
        ),
        (
            terminal("incomplete", incomplete_details={"reason": "content_filter"}),
            "error",
            "incomplete.content_filter",
        ),
        (terminal("incomplete"), "error", "incomplete"),
        (
            terminal("failed", error={"code": "server_error", "message": "failed generation"}),
            "error",
            "failed",
        ),
        (
            {"type": "error", "code": "bad_request", "message": "invalid input"},
            "error",
            "bad_request",
        ),
        ({"type": "response.auxiliary", "metadata": {}}, "error", None),
    ],
)
async def test_overall_terminal_mapping(provider, sdk_harness, response_sse, event, expected, raw):
    data = response_sse(
        item_event("done", 0, message("msg_1", "partial")),
        {"type": "response.future_auxiliary", "foo": "bar"},
        event,
    )
    async with sdk_harness(data=data) as (models, http, _):
        response = models.stream(
            provider.get_models()[0],
            Context(messages=[]),
            ResponsesOptions(api_key="key", http_client=http),
        )
        final = await response.result()
        events = [e async for e in response]
        assert final.stop_reason == expected
        assert final.raw_stop_reason == raw
        assert final.content[0].text == "partial"
        assert sum(e["type"] in ("done", "error") for e in events) == 1
        if expected == "error":
            assert final.error_message


@pytest.mark.asyncio
async def test_completed_function_call_is_tool_use(provider, sdk_harness, response_sse):
    data = response_sse(
        item_event(
            "done",
            0,
            {
                "type": "function_call",
                "id": "fc_1",
                "call_id": "c",
                "name": "run",
                "arguments": "{}",
            },
        ),
        terminal(),
    )
    async with sdk_harness(data=data) as (models, http, _):
        final = await models.complete(
            provider.get_models()[0],
            Context(messages=[]),
            ResponsesOptions(api_key="key", http_client=http),
        )
        assert final.stop_reason == "tool_use"


@pytest.mark.asyncio
async def test_terminal_backfills_only_matching_missing_reasoning_signature(
    provider, sdk_harness, response_sse
):
    a = {"type": "reasoning", "id": "rs_a", "summary": [{"type": "summary_text", "text": "A"}]}
    b = {"type": "reasoning", "id": "rs_b", "summary": [], "encrypted_content": "original"}
    data = response_sse(
        item_event("done", 0, a),
        item_event("done", 1, b),
        terminal(
            output=[
                {**b, "encrypted_content": "replacement"},
                {**a, "encrypted_content": "late", "summary": []},
                {"type": "reasoning", "id": "unrelated", "encrypted_content": "unrelated"},
            ]
        ),
    )
    async with sdk_harness(data=data) as (models, http, _):
        final = await models.complete(
            provider.get_models()[0],
            Context(messages=[]),
            ResponsesOptions(api_key="key", http_client=http),
        )
        assert final.stop_reason == "stop", final.error_message
        assert json.loads(final.content[0].thinking_signature) == {**a, "encrypted_content": "late"}
        assert json.loads(final.content[1].thinking_signature) == b
        assert len(final.content) == 2 and final.content[0].thinking == "A"
