"""Saved frames recover independent progress while final messages are stored separately."""

from copy import deepcopy

import pytest

from app.ai.assistant_message_frames import (
    AssistantMessageFrameEncoder,
    reduce_assistant_message_frames,
)
from app.ai.messages import AssistantMessage, TextContent


def message(content):
    return AssistantMessage(provider="p", api="a", model="m", timestamp=1, content=content)


def test_text_events_encode_and_recover_progress_without_final_settlement():
    partial = message([TextContent(text="")])
    encoder = AssistantMessageFrameEncoder()
    frames = [
        encoder.encode({"type": "start", "partial": partial}),
        encoder.encode({"type": "text_start", "content_index": 0, "partial": partial}),
    ]
    for text in ("Hello", " world"):
        partial.content[0].text += text
        frames.append(
            encoder.encode(
                {"type": "text_delta", "content_index": 0, "delta": text, "partial": partial}
            )
        )
    frames.append(
        encoder.encode(
            {"type": "text_end", "content_index": 0, "content": "Hello world", "partial": partial}
        )
    )
    partial.stop_reason = "stop"
    assert encoder.encode({"type": "done", "reason": "stop", "message": partial}) is None
    restored = reduce_assistant_message_frames(frames)
    assert restored.content == [TextContent(text="Hello world")]
    assert restored.stop_reason == "pending"
    restored.content[0].text = "changed"
    assert partial.content[0].text == "Hello world"


def test_queued_text_deltas_do_not_repeat_already_visible_snapshot():
    partial = message([TextContent(text="")])
    start = {"type": "text_start", "content_index": 0, "partial": partial}
    partial.content[0].text = "Hello"
    encoder = AssistantMessageFrameEncoder()
    frames = [encoder.encode({"type": "start", "partial": partial}), encoder.encode(start)]
    snapshot = deepcopy(frames)
    assert (
        encoder.encode(
            {"type": "text_delta", "content_index": 0, "partial": partial, "delta": "Hel"}
        )
        is None
    )
    delta = encoder.encode(
        {"type": "text_delta", "content_index": 0, "partial": partial, "delta": "lo world"}
    )
    assert delta["delta"] == " world"
    frames.append(delta)
    partial.content[0].text = "later"
    assert frames[:2] == snapshot
    assert reduce_assistant_message_frames(frames).content == [TextContent(text="Hello world")]


def test_thinking_frames_preserve_redaction_and_final_signature():
    from app.ai.messages import ThinkingContent

    partial = message([ThinkingContent(thinking="hidden", thinking_signature="old", redacted=True)])
    encoder = AssistantMessageFrameEncoder()
    frames = [
        encoder.encode({"type": "start", "partial": partial}),
        encoder.encode({"type": "thinking_start", "content_index": 0, "partial": partial}),
    ]
    assert (
        encoder.encode(
            {"type": "thinking_delta", "content_index": 0, "delta": "hidden", "partial": partial}
        )
        is None
    )
    partial.content[0].thinking_signature = "new"
    frames.append(
        encoder.encode(
            {"type": "thinking_end", "content_index": 0, "content": "hidden", "partial": partial}
        )
    )
    restored = reduce_assistant_message_frames(frames)
    assert restored.content == [
        ThinkingContent(thinking="hidden", thinking_signature="new", redacted=True)
    ]
    assert frames[1]["content"].thinking_signature == "old"


@pytest.mark.parametrize(
    "snapshot, fragment, expected",
    [
        ({"city": "Bei"}, '{"city":"Beijing', {"city": "Beijing"}),
        ({"items": ["a"]}, '{"items":["a","b"', {"items": ["a", "b"]}),
        ({"n": 1}, '{"n":1', {"n": 1}),
    ],
)
def test_tool_checkpoint_waits_until_json_catches_up_or_extends_snapshot(
    snapshot, fragment, expected
):
    from app.ai.messages import ToolCall

    partial = message([ToolCall(id="c", name="t", arguments=snapshot)])
    encoder = AssistantMessageFrameEncoder()
    frames = [
        encoder.encode({"type": "start", "partial": partial}),
        encoder.encode({"type": "toolcall_start", "content_index": 0, "partial": partial}),
    ]
    cut = 3
    assert (
        encoder.encode(
            {
                "type": "toolcall_delta",
                "content_index": 0,
                "delta": fragment[:cut],
                "partial": partial,
            }
        )
        is None
    )
    checkpoint = encoder.encode(
        {"type": "toolcall_delta", "content_index": 0, "delta": fragment[cut:], "partial": partial}
    )
    assert checkpoint == {"type": "toolcall_checkpoint", "content_index": 0, "json": fragment}
    frames.append(checkpoint)
    restored = reduce_assistant_message_frames(frames)
    assert restored.content[0].arguments == expected
    assert partial.content[0].arguments == snapshot
    final = ToolCall(id="final-id", name="final-name", arguments=[1, 2], namespace="ns")
    frames.append(
        encoder.encode(
            {"type": "toolcall_end", "content_index": 0, "tool_call": final, "partial": partial}
        )
    )
    assert reduce_assistant_message_frames(frames).content == [final]


def test_unfinished_tool_uses_initial_snapshot_until_end_even_without_catchup():
    from app.ai.messages import ToolCall

    partial = message(
        [ToolCall(id="c", name="t", arguments={"x": "complete"}, thought_signature="old")]
    )
    encoder = AssistantMessageFrameEncoder()
    frames = [
        encoder.encode({"type": "start", "partial": partial}),
        encoder.encode({"type": "toolcall_start", "content_index": 0, "partial": partial}),
    ]
    assert (
        encoder.encode(
            {"type": "toolcall_delta", "content_index": 0, "delta": '{"x":"c', "partial": partial}
        )
        is None
    )
    assert reduce_assistant_message_frames(frames).content[0].arguments == {"x": "complete"}
    final = ToolCall(id="c", name="t", arguments=None)
    frames.append(
        encoder.encode(
            {"type": "toolcall_end", "content_index": 0, "partial": partial, "tool_call": final}
        )
    )
    assert reduce_assistant_message_frames(frames).content == [final]


def test_handwritten_tool_frames_recover_json_and_empty_sequences_stay_empty():
    from app.ai.messages import ToolCall

    frames = [
        {"type": "start", "partial": message([])},
        {
            "type": "toolcall_start",
            "content_index": 0,
            "tool_call": ToolCall(id="c", name="t", arguments={}),
        },
        {"type": "toolcall_delta", "content_index": 0, "delta": '{"x":"a'},
        {"type": "toolcall_delta", "content_index": 0, "delta": "b"},
    ]
    assert reduce_assistant_message_frames(frames).content[0].arguments == {"x": "ab"}
    assert reduce_assistant_message_frames([]) is None
    assert reduce_assistant_message_frames([frames[-1]]) is None


@pytest.mark.parametrize(
    "case",
    [
        "duplicate_start",
        "late_start",
        "gap",
        "missing_block",
        "wrong_type",
        "after_end",
        "duplicate_block",
        "negative",
        "bool_index",
        "large_index",
    ],
)
def test_handwritten_frame_sequences_reject_invalid_order_and_block_types(case):
    start = {"type": "start", "partial": message([])}
    block = {"type": "text_start", "content_index": 0, "content": TextContent(text="")}
    delta = {"type": "text_delta", "content_index": 0, "delta": "x"}
    end = {"type": "text_end", "content_index": 0, "content": "", "text_signature": None}
    sequences = {
        "duplicate_start": [start, start],
        "late_start": [delta, start],
        "gap": [start, {**block, "content_index": 1}],
        "missing_block": [start, delta],
        "wrong_type": [start, block, {**delta, "type": "thinking_delta"}],
        "after_end": [start, block, end, delta],
        "duplicate_block": [start, block, block],
        "negative": [start, {**block, "content_index": -1}],
        "bool_index": [start, {**block, "content_index": False}],
        "large_index": [start, {**block, "content_index": 2**53}],
    }
    with pytest.raises(ValueError):
        reduce_assistant_message_frames(sequences[case])


def test_encoder_requires_start_and_rejects_events_after_terminal():
    partial = message([TextContent(text="")])
    event = {"type": "text_start", "content_index": 0, "partial": partial}
    encoder = AssistantMessageFrameEncoder()
    with pytest.raises(ValueError):
        encoder.encode(event)
    with pytest.raises(ValueError):
        encoder.encode({"type": "done", "reason": "stop", "message": partial})
    assert encoder.encode({"type": "error", "reason": "error", "error": partial}) is None
    with pytest.raises(ValueError):
        encoder.encode({"type": "start", "partial": partial})


def test_saved_frame_json_round_trip_and_interleaved_tool_blocks():
    from pydantic import TypeAdapter

    from app.ai.assistant_message_frames import AssistantMessageFrame
    from app.ai.messages import ToolCall

    partial = message(
        [
            ToolCall(id="a", name="first", arguments={}),
            ToolCall(id="b", name="second", arguments={}),
        ]
    )
    encoder = AssistantMessageFrameEncoder()
    frames = [encoder.encode({"type": "start", "partial": partial})]
    for index in (0, 1):
        frames.append(
            encoder.encode({"type": "toolcall_start", "content_index": index, "partial": partial})
        )
    for index, delta in [(0, '{"x":'), (1, "[1"), (0, "2}"), (1, ",3]")]:
        frames.append(
            encoder.encode(
                {
                    "type": "toolcall_delta",
                    "content_index": index,
                    "delta": delta,
                    "partial": partial,
                }
            )
        )
    adapter = TypeAdapter(list[AssistantMessageFrame])
    saved = adapter.dump_json(frames)
    loaded = adapter.validate_json(saved)
    restored = reduce_assistant_message_frames(loaded)
    assert [b.arguments for b in restored.content] == [{"x": 2}, [1, 3]]
    assert partial.content[0].arguments == {}


def test_encoder_rejects_block_type_changes_and_deltas_after_end():
    from app.ai.messages import ThinkingContent

    partial = message([TextContent(text="")])
    encoder = AssistantMessageFrameEncoder()
    encoder.encode({"type": "start", "partial": partial})
    encoder.encode({"type": "text_start", "content_index": 0, "partial": partial})
    with pytest.raises(ValueError):
        encoder.encode(
            {"type": "thinking_delta", "content_index": 0, "delta": "x", "partial": partial}
        )
    partial.content[0] = ThinkingContent(thinking="")
    with pytest.raises(ValueError):
        encoder.encode({"type": "text_end", "content_index": 0, "content": "", "partial": partial})
    partial.content[0] = TextContent(text="")
    encoder.encode({"type": "text_end", "content_index": 0, "content": "", "partial": partial})
    with pytest.raises(ValueError):
        encoder.encode({"type": "text_delta", "content_index": 0, "delta": "x", "partial": partial})
