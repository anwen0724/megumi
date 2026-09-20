"""Assistant progress event data; production, queues and cancellation live elsewhere."""

from typing import Literal, TypedDict

from app.ai.messages import AssistantMessage, ToolCall


class StartEvent(TypedDict):
    """Begin a response; partial is a shared live reference."""

    type: Literal["start"]
    partial: AssistantMessage


class BlockStartEvent(TypedDict):
    """Begin a content block by index in the live message."""

    type: Literal["text_start", "thinking_start", "toolcall_start"]
    content_index: int
    partial: AssistantMessage


class BlockDeltaEvent(TypedDict):
    """A text increment; partial may have advanced beyond this queued event."""

    type: Literal["text_delta", "thinking_delta", "toolcall_delta"]
    content_index: int
    delta: str
    partial: AssistantMessage


class TextEndEvent(TypedDict):
    """Authoritative text at block completion."""

    type: Literal["text_end", "thinking_end"]
    content_index: int
    content: str
    partial: AssistantMessage


class DoneEvent(TypedDict):
    """A final successful message, persisted separately from progress frames."""

    type: Literal["done"]
    reason: Literal["stop", "length", "tool_use"]
    message: AssistantMessage


class ErrorEvent(TypedDict):
    """A final failed or canceled message, possibly without a preceding start."""

    type: Literal["error"]
    reason: Literal["error", "aborted"]
    error: AssistantMessage


class ToolEndEvent(TypedDict):
    """Authoritative final tool call; its arguments may still be unvalidated."""

    type: Literal["toolcall_end"]
    content_index: int
    tool_call: ToolCall
    partial: AssistantMessage


type AssistantMessageEvent = (
    StartEvent
    | BlockStartEvent
    | BlockDeltaEvent
    | TextEndEvent
    | DoneEvent
    | ErrorEvent
    | ToolEndEvent
)
