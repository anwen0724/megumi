"""Copy assistant progress into replayable frames, independently of final settlement."""

from collections.abc import Iterable
from copy import deepcopy
from dataclasses import dataclass, replace
from typing import Literal, NotRequired, TypedDict

from app.ai.errors import FrameSequenceError
from app.ai.events import (
    AssistantMessageEvent,
    BlockDeltaEvent,
    BlockStartEvent,
    TextEndEvent,
    ToolEndEvent,
)
from app.ai.messages import (
    AssistantContent,
    AssistantMessage,
    JSONValue,
    TextContent,
    ThinkingContent,
    ToolCall,
)
from app.ai.tools.arguments import parse_partial_arguments


class StartFrame(TypedDict):
    """Independent message metadata at the beginning of progress replay."""

    type: Literal["start"]
    partial: AssistantMessage


class ContentStartFrame(TypedDict):
    """Initial text content snapshot."""

    type: Literal["text_start", "thinking_start"]
    content_index: int
    content: TextContent | ThinkingContent


class ContentDeltaFrame(TypedDict):
    """New text not represented in the initial snapshot."""

    type: Literal["text_delta", "thinking_delta", "toolcall_delta"]
    content_index: int
    delta: str


class TextEndFrame(TypedDict):
    """Authoritative text and replay signature."""

    type: Literal["text_end"]
    content_index: int
    content: str
    text_signature: NotRequired[str | None]


class ThinkingEndFrame(TypedDict):
    """Authoritative reasoning content and its opaque replay metadata."""

    type: Literal["thinking_end"]
    content_index: int
    content: str
    thinking_signature: NotRequired[str | None]
    redacted: NotRequired[bool | None]


class ToolStartFrame(TypedDict):
    """A consumed tool-start snapshot, potentially ahead of queued deltas."""

    type: Literal["toolcall_start"]
    content_index: int
    tool_call: ToolCall


class ToolCheckpointFrame(TypedDict):
    """Cumulative JSON after queued deltas catch up to a published snapshot."""

    type: Literal["toolcall_checkpoint"]
    content_index: int
    json: str


class ToolEndFrame(TypedDict):
    """Final tool fields replace partial values without validation or execution."""

    type: Literal["toolcall_end"]
    content_index: int
    id: str
    name: str
    arguments: JSONValue
    thought_signature: NotRequired[str | None]
    namespace: NotRequired[str | None]


type AssistantMessageFrame = (
    StartFrame
    | ContentStartFrame
    | ContentDeltaFrame
    | TextEndFrame
    | ThinkingEndFrame
    | ToolStartFrame
    | ToolCheckpointFrame
    | ToolEndFrame
)


@dataclass
class _TextState:
    """Per-block offsets account for live partials observed after event publication."""

    covered: int
    seen: int = 0


@dataclass
class _ToolState:
    """Initial parsed snapshot and JSON accumulated until it catches up."""

    snapshot: JSONValue
    caught_up: bool
    json: str = ""


class AssistantMessageFrameEncoder:
    """Encode one assistant response; returned frames own their snapshots."""

    def __init__(self) -> None:
        """Track independent offsets for each text block."""
        self._started = False
        self._terminal = False
        self._active: dict[int, str] = {}
        self._text: dict[int, _TextState] = {}
        self._tools: dict[int, _ToolState] = {}

    def encode(self, event: AssistantMessageEvent) -> AssistantMessageFrame | None:
        """Copy progress data without encoding the final done/error message."""
        if self._terminal:
            raise FrameSequenceError("event follows terminal event")
        if event["type"] == "start":
            if self._started:
                raise FrameSequenceError("duplicate start event")
            self._started = True
            return {
                "type": "start",
                "partial": replace(
                    deepcopy(event["partial"]),
                    content=[],
                    stop_reason="pending",
                    error_message=None,
                    raw_stop_reason=None,
                    end_turn=None,
                ),
            }
        if event["type"] == "done" or event["type"] == "error":
            if event["type"] == "done" and not self._started:
                raise FrameSequenceError("done event before start")
            self._terminal = True
            return None
        if not self._started:
            raise FrameSequenceError("content event before start")
        index = event["content_index"]
        _check_index(index)
        kind = _event_kind(event["type"])
        if event["type"].endswith("_start"):
            if index in self._active:
                raise FrameSequenceError("duplicate block start")
            _event_block(event, kind)
            self._active[index] = kind
        else:
            if self._active.get(index) != kind:
                raise FrameSequenceError("block has not started or has a different type")
            if event["type"].endswith("_end"):
                _event_block(event, kind)
                self._active.pop(index)
        if event["type"] in ("text_start", "thinking_start"):
            block = event["partial"].content[index]
            assert isinstance(block, (TextContent, ThinkingContent))
            self._text[index] = _TextState(
                len(block.text if isinstance(block, TextContent) else block.thinking)
            )
            return {"type": event["type"], "content_index": index, "content": deepcopy(block)}
        if event["type"] in ("text_delta", "thinking_delta"):
            state = self._text[index]
            covered = max(0, state.covered - state.seen)
            state.seen += len(event["delta"])
            uncovered = event["delta"][covered:]
            return (
                {"type": event["type"], "content_index": index, "delta": uncovered}
                if uncovered
                else None
            )
        if event["type"] == "toolcall_start":
            block = event["partial"].content[index]
            assert isinstance(block, ToolCall)
            self._tools[index] = _ToolState(deepcopy(block.arguments), block.arguments == {})
            return {"type": "toolcall_start", "content_index": index, "tool_call": deepcopy(block)}
        if event["type"] == "toolcall_delta":
            tool_state = self._tools[index]
            if tool_state.caught_up:
                return (
                    {"type": "toolcall_delta", "content_index": index, "delta": event["delta"]}
                    if event["delta"]
                    else None
                )
            tool_state.json += event["delta"]
            parsed = parse_partial_arguments(tool_state.json)
            if not _is_json_prefix(tool_state.snapshot, parsed):
                return None
            tool_state.caught_up = True
            checkpoint = tool_state.json
            tool_state.json = ""
            return {"type": "toolcall_checkpoint", "content_index": index, "json": checkpoint}
        if event["type"] == "toolcall_end":
            final = deepcopy(event["tool_call"])
            self._tools.pop(index)
            return {
                "type": "toolcall_end",
                "content_index": index,
                "id": final.id,
                "name": final.name,
                "arguments": final.arguments,
                "thought_signature": final.thought_signature,
                "namespace": final.namespace,
            }
        assert event["type"] == "text_end" or event["type"] == "thinking_end"
        block = event["partial"].content[index]
        if isinstance(block, ThinkingContent):
            return {
                "type": "thinking_end",
                "content_index": index,
                "content": event["content"],
                "thinking_signature": block.thinking_signature,
                "redacted": block.redacted,
            }
        assert isinstance(block, TextContent)
        return {
            "type": "text_end",
            "content_index": index,
            "content": event["content"],
            "text_signature": block.text_signature,
        }


def reduce_assistant_message_frames(
    frames: Iterable[AssistantMessageFrame],
) -> AssistantMessage | None:
    """Recover an independent partial message; no start means no recoverable message."""
    message: AssistantMessage | None = None
    tool_json: dict[int, str] = {}
    active: dict[int, str] = {}
    ended: set[int] = set()
    frame_before_start = False
    for frame in frames:
        if frame["type"] == "start":
            if message is not None or frame_before_start:
                raise FrameSequenceError("duplicate or late start frame")
            message = deepcopy(frame["partial"])
        elif message is None:
            frame_before_start = True
        else:
            index = frame["content_index"]
            _check_index(index)
            kind = _event_kind(frame["type"])
            if frame["type"].endswith("_start"):
                if index != len(message.content):
                    raise FrameSequenceError("block index must be continuous without duplicates")
                block_value = (
                    frame.get("tool_call")
                    if frame["type"] == "toolcall_start"
                    else frame.get("content")
                )
                if not _matches_block(block_value, kind):
                    raise FrameSequenceError("start frame content type mismatch")
                active[index] = kind
            elif active.get(index) != kind or index in ended:
                raise FrameSequenceError("frame has no active block of its type")
            if frame["type"].endswith("_end"):
                ended.add(index)
            if frame["type"] in ("text_start", "thinking_start"):
                message.content.append(deepcopy(frame["content"]))
            elif frame["type"] == "toolcall_start":
                message.content.append(deepcopy(frame["tool_call"]))
                tool_json[frame["content_index"]] = ""
            elif frame["type"] == "toolcall_checkpoint":
                index = frame["content_index"]
                tool_json[index] = frame["json"]
                block = message.content[index]
                assert isinstance(block, ToolCall)
                block.arguments = parse_partial_arguments(frame["json"])
            elif frame["type"] == "toolcall_delta":
                tool_json[frame["content_index"]] += frame["delta"]
            elif frame["type"] == "toolcall_end":
                index = frame["content_index"]
                message.content[index] = ToolCall(
                    id=frame["id"],
                    name=frame["name"],
                    arguments=deepcopy(frame["arguments"]),
                    thought_signature=frame.get("thought_signature"),
                    namespace=frame.get("namespace"),
                )
                tool_json.pop(index, None)
            else:
                block = message.content[frame["content_index"]]
                assert isinstance(block, (TextContent, ThinkingContent))
                if frame["type"] in ("text_delta", "thinking_delta"):
                    if isinstance(block, TextContent):
                        block.text += frame["delta"]
                    else:
                        block.thinking += frame["delta"]
                elif frame["type"] == "text_end":
                    assert isinstance(block, TextContent)
                    block.text = frame["content"]
                    block.text_signature = frame.get("text_signature")
                elif frame["type"] == "thinking_end":
                    assert isinstance(block, ThinkingContent)
                    block.thinking = frame["content"]
                    block.thinking_signature = frame.get("thinking_signature")
                    block.redacted = frame.get("redacted")
    if message is not None:
        for index, text in tool_json.items():
            if text:
                block = message.content[index]
                assert isinstance(block, ToolCall)
                block.arguments = parse_partial_arguments(text)
    return message


def _is_json_prefix(snapshot: JSONValue, current: JSONValue) -> bool:
    """Match pi's structural prefix rule, keeping booleans distinct from numbers."""
    if isinstance(snapshot, str):
        return isinstance(current, str) and current.startswith(snapshot)
    if isinstance(snapshot, list):
        return (
            isinstance(current, list)
            and len(snapshot) <= len(current)
            and all(_is_json_prefix(value, current[i]) for i, value in enumerate(snapshot))
        )
    if isinstance(snapshot, dict):
        return isinstance(current, dict) and all(
            name in current and _is_json_prefix(value, current[name])
            for name, value in snapshot.items()
        )
    if isinstance(snapshot, bool) or isinstance(current, bool):
        return type(snapshot) is type(current) and snapshot == current
    return snapshot == current


def _check_index(index: int) -> None:
    """Match the non-negative safe integer constraint in the frame contract."""
    if type(index) is not int or index < 0 or index > 2**53 - 1:
        raise FrameSequenceError("content index must be a non-negative safe integer")


def _event_kind(event_type: str) -> str:
    """Map frame/event prefixes to message block discriminators."""
    prefix = event_type.split("_", 1)[0]
    return "toolCall" if prefix == "toolcall" else prefix


def _matches_block(block: object, kind: str) -> bool:
    """Validate actual content class and discriminator before using saved values."""
    classes = {"text": TextContent, "thinking": ThinkingContent, "toolCall": ToolCall}
    expected = classes.get(kind)
    return (
        expected is not None
        and isinstance(block, (TextContent, ThinkingContent, ToolCall))
        and isinstance(block, expected)
        and block.type == kind
    )


def _event_block(
    event: BlockStartEvent | BlockDeltaEvent | TextEndEvent | ToolEndEvent, kind: str
) -> AssistantContent:
    """Check block index and type at start/end without validating tool arguments."""
    index = event["content_index"]
    content = event["partial"].content
    if index >= len(content) or not _matches_block(content[index], kind):
        raise FrameSequenceError("event content block type or index mismatch")
    if event["type"] == "toolcall_end" and not _matches_block(event["tool_call"], "toolCall"):
        raise FrameSequenceError("invalid final tool block")
    return content[index]
