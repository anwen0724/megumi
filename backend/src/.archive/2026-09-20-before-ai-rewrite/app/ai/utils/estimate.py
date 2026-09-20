"""Estimates how much of a model's context window a transcript occupies.

An estimate has two halves. Past assistant responses report exact token usage, and the
newest applicable one is authoritative for everything up to that point. Everything after
it — and a transcript with no usable usage at all — is approximated from character counts.
Only the estimate is approximate; the arithmetic that combines it with reported usage is
not.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass, is_dataclass
from typing import Any

from app.ai.types import (
    AssistantMessage,
    ImageContent,
    Message,
    StopReason,
    SystemMessage,
    TextContent,
    ToolCall,
    ToolResultMessage,
    TranscriptContext,
    Usage,
    UserMessage,
)
from app.ai.utils.text import getSystemMessageText

__all__ = [
    "ContextUsageEstimate",
    "calculateContextTokens",
    "estimateContextTokens",
    "estimateMessageTokens",
    "estimateTextAndImageContentTokens",
    "estimateTextTokens",
]

CHARS_PER_TOKEN = 4
ESTIMATED_IMAGE_CHARS = 4800


@dataclass(slots=True)
class ContextUsageEstimate:
    """How full a transcript is, and where the number came from."""

    tokens: int
    usageTokens: int
    trailingTokens: int
    lastUsageIndex: int | None


def _to_jsonable(value: Any) -> Any:
    """Replace dataclasses with their field mappings so the value can be serialized."""

    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    return value


def _safe_json_dumps(value: object) -> str:
    """Serialize ``value`` for length purposes, never failing on an unserializable one."""

    try:
        return json.dumps(_to_jsonable(value))
    except (TypeError, ValueError):
        return "[unserializable]"


def calculateContextTokens(usage: Usage) -> int:
    """The context tokens a usage block accounts for.

    ``totalTokens`` is preferred, and a zero total falls back to the sum of the parts,
    which is how a provider that omits the total is still usable.
    """

    return usage.totalTokens or (
        usage.input + usage.output + usage.cacheRead + usage.cacheWrite
    )


def estimateTextTokens(text: str) -> int:
    """Approximate the tokens in ``text``."""

    return -(-len(text) // CHARS_PER_TOKEN)


def _estimateTextAndImageContentChars(content: str | list[TextContent | ImageContent]) -> int:
    """The character count of message content, charging a fixed cost per image."""

    if isinstance(content, str):
        return len(content)
    return sum(
        len(block.text) if isinstance(block, TextContent) else ESTIMATED_IMAGE_CHARS
        for block in content
    )


def estimateTextAndImageContentTokens(content: str | list[TextContent | ImageContent]) -> int:
    """Approximate the tokens in message content."""

    return -(-_estimateTextAndImageContentChars(content) // CHARS_PER_TOKEN)


def _estimateToolsTokens(tools: Sequence[object] | None) -> int:
    """Approximate the tokens a tool declaration or removal list costs."""

    if not tools:
        return 0
    return estimateTextTokens(_safe_json_dumps(list(tools)))


def estimateMessageTokens(message: Message) -> int:
    """Approximate the tokens one message costs.

    A system message costs its rendered prompt plus whatever tools it adds or removes.
    """

    if isinstance(message, SystemMessage):
        return (
            estimateTextTokens(getSystemMessageText(message))
            + _estimateToolsTokens(message.toolsAdded)
            + _estimateToolsTokens(message.toolsRemoved)
        )
    if isinstance(message, UserMessage):
        return estimateTextAndImageContentTokens(message.content)
    if isinstance(message, ToolResultMessage):
        return estimateTextAndImageContentTokens(message.content)

    chars = 0
    for block in message.content:
        if isinstance(block, TextContent):
            chars += len(block.text)
        elif isinstance(block, ToolCall):
            chars += len(block.name) + len(_safe_json_dumps(block.arguments))
        else:
            chars += len(block.thinking)
    return -(-chars // CHARS_PER_TOKEN)


def _getLastAssistantUsageInfo(messages: list[Message]) -> tuple[Usage, int] | None:
    """The newest usage block that still describes the current prefix, and its index.

    A message inserted after a response — a compaction summary, for instance — makes that
    response's usage describe an older prefix, so usage only counts while its timestamp is
    at least as recent as every message seen so far.
    """

    latest_prefix_timestamp = float("-inf")
    found: tuple[Usage, int] | None = None

    for index, message in enumerate(messages):
        if isinstance(message, AssistantMessage):
            usage_applies_to_prefix = message.timestamp >= latest_prefix_timestamp
            if (
                usage_applies_to_prefix
                and message.stopReason not in (StopReason.ABORTED, StopReason.ERROR)
                and calculateContextTokens(message.usage) > 0
            ):
                found = (message.usage, index)
        latest_prefix_timestamp = max(latest_prefix_timestamp, message.timestamp)

    return found


def estimateContextTokens(context: TranscriptContext | list[Message]) -> ContextUsageEstimate:
    """Estimate the context tokens used by ``context``.

    With usable usage, the result is that usage plus an estimate of everything after it;
    without any, the whole transcript is estimated and the usage half is zero.
    """

    messages = context.messages if isinstance(context, TranscriptContext) else context
    usage_info = _getLastAssistantUsageInfo(messages)
    if usage_info is not None:
        usage, index = usage_info
        usage_tokens = calculateContextTokens(usage)
        trailing_tokens = sum(
            estimateMessageTokens(message) for message in messages[index + 1 :]
        )
        return ContextUsageEstimate(
            tokens=usage_tokens + trailing_tokens,
            usageTokens=usage_tokens,
            trailingTokens=trailing_tokens,
            lastUsageIndex=index,
        )

    tokens = sum(estimateMessageTokens(message) for message in messages)
    return ContextUsageEstimate(
        tokens=tokens,
        usageTokens=0,
        trailingTokens=tokens,
        lastUsageIndex=None,
    )
