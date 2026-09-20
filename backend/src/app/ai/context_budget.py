"""Estimate context and output room without changing reported message usage."""

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass

from app.ai.messages import (
    AssistantMessage,
    ImageContent,
    Message,
    SystemMessage,
    TextContent,
    ThinkingContent,
    Transcript,
    Usage,
)
from app.ai.model import Model
from app.ai.transcript import get_system_message_text


@dataclass(frozen=True)
class ContextUsageEstimate:
    """Separate a reported anchor from estimated trailing content."""

    tokens: int
    usage_tokens: int
    trailing_tokens: int
    last_usage_index: int | None


def _units(text: str) -> int:
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def estimate_text_tokens(text: str) -> int:
    """Match pi's UTF-16 length estimate, including unpaired surrogates."""
    return (_units(text) + 3) // 4


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def estimate_message_tokens(message: Message) -> int:
    """Estimate visible content and tool declarations, without charging signatures."""
    if isinstance(message, SystemMessage):
        tools = [
            {k: v for k, v in asdict(tool).items() if v is not None}
            for tool in message.tools_added or []
        ]
        return (
            estimate_text_tokens(get_system_message_text(message))
            + (estimate_text_tokens(_json(tools)) if tools else 0)
            + (estimate_text_tokens(_json(message.tools_removed)) if message.tools_removed else 0)
        )
    if isinstance(message.content, str):
        return estimate_text_tokens(message.content)
    chars = 0
    for block in message.content:
        if isinstance(block, ImageContent):
            chars += 4800
        elif isinstance(block, TextContent):
            chars += _units(block.text)
        elif isinstance(block, ThinkingContent):
            chars += _units(block.thinking)
        else:
            chars += _units(block.name) + _units(_json(block.arguments))
    return (chars + 3) // 4


def calculate_context_tokens(usage: Usage) -> int | None:
    """Use a positive reported total or a fully known component sum."""
    if usage.total_tokens is not None and usage.total_tokens > 0:
        return usage.total_tokens
    values = (usage.input, usage.output, usage.cache_read, usage.cache_write)
    if any(v is None for v in values):
        return None
    return sum(v for v in values if v is not None)


def estimate_context_tokens(context: Transcript | Sequence[Message]) -> ContextUsageEstimate:
    """Select the latest applicable usage anchor, then estimate trailing messages."""
    messages = context.messages if isinstance(context, Transcript) else context
    latest_timestamp: int | None = None
    anchor: int | None = None
    usage_tokens = 0
    for index, message in enumerate(messages):
        if (
            isinstance(message, AssistantMessage)
            and message.stop_reason not in {"error", "aborted"}
            and (latest_timestamp is None or message.timestamp >= latest_timestamp)
        ):
            count = calculate_context_tokens(message.usage)
            if count is not None and count > 0:
                anchor, usage_tokens = index, count
        latest_timestamp = (
            max(latest_timestamp, message.timestamp)
            if latest_timestamp is not None
            else message.timestamp
        )
    trailing = sum(
        estimate_message_tokens(m) for m in messages[anchor + 1 if anchor is not None else 0 :]
    )
    return ContextUsageEstimate(usage_tokens + trailing, usage_tokens, trailing, anchor)


def clamp_max_tokens_to_context(model: Model, context: Transcript, max_tokens: int) -> int:
    """Reserve context room without truncating input."""
    available = model.context_window - estimate_context_tokens(context).tokens - 4096
    return min(max_tokens, max(1, available))


def adjust_max_tokens_for_thinking(
    base_max_tokens: int | None,
    model_max_tokens: int,
    reasoning: str,
    custom_budgets: Mapping[str, int] | None = None,
) -> tuple[int, int]:
    """Fit thinking and answer under the model ceiling, following pi budgets."""
    budgets = {
        "minimal": 1024,
        "low": 2048,
        "medium": 8192,
        "high": 16384,
        **(custom_budgets or {}),
    }
    budget = budgets["high" if reasoning in {"xhigh", "max"} else reasoning]
    maximum = (
        model_max_tokens
        if base_max_tokens is None
        else min(base_max_tokens + budget, model_max_tokens)
    )
    if maximum <= budget:
        budget = min(budget, max(0, maximum - 1024))
    return maximum, budget


_OVERFLOW = re.compile(
    "|".join(
        [
            r"prompt is too long",
            r"request_too_large",
            r"input is too long for requested model",
            r"exceeds the context window",
            r"exceeds (?:the )?(?:model'?s )?maximum context length"
            r"(?: of [\d,]+ tokens?|\s*\([\d,]+\))",
            r"input token count.*exceeds the maximum",
            r"maximum prompt length is \d+",
            r"reduce the length of the messages",
            r"maximum context length is \d+ tokens",
            r"exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?",
            r"input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)",
            r"exceeds the limit of \d+",
            r"exceeds the available context size",
            r"greater than the context length",
            r"context window exceeds limit",
            r"exceeded model token limit",
            r"too large for model with \d+ maximum context length",
            r"prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?",
            r"model_context_window_exceeded",
            r"prompt too long; exceeded (?:max )?context length",
            r"range of input length should be",
            r"context[_ ]length[_ ]exceeded",
            r"too many tokens",
            r"token limit exceeded",
            r"^4(?:00|13)\s*(?:status code)?\s*\(no body\)",
        ]
    ),
    re.I,
)
_NON_OVERFLOW = re.compile(
    r"^(Throttling error|Service unavailable):|rate limit|too many requests", re.I
)


def is_context_overflow(message: AssistantMessage, context_window: int | None = None) -> bool:
    """Detect pi error patterns or fully known usage evidence of context pressure."""
    error = message.error_message or ""
    if (
        message.stop_reason == "error"
        and not _NON_OVERFLOW.search(error)
        and _OVERFLOW.search(error)
    ):
        return True
    usage = message.usage
    if not context_window or usage.input is None or usage.cache_read is None:
        return False
    input_tokens = usage.input + usage.cache_read
    return (message.stop_reason == "stop" and input_tokens > context_window) or (
        message.stop_reason == "length"
        and usage.output == 0
        and input_tokens >= context_window * 0.99
    )


def is_recoverable_length(message: AssistantMessage, desired_max_output: int) -> bool:
    """Unknown output cannot prove that the original limit was not reached."""
    return (
        message.stop_reason == "length"
        and desired_max_output > 0
        and message.usage.output is not None
        and message.usage.output < desired_max_output
    )
