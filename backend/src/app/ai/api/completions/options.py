"""Explicit Chat Completions options share common call controls."""

from dataclasses import dataclass, fields

from app.ai.messages import JSONValue
from app.ai.options import CallOptions, SimpleOptions


@dataclass(frozen=True, kw_only=True)
class CompletionsOptions(CallOptions):
    """Options for the Chat Completions protocol."""

    reasoning_effort: str | None = None
    thinking: dict[str, JSONValue] | None = None
    tool_choice: str | dict[str, JSONValue] | None = None


def from_simple(options: SimpleOptions) -> CompletionsOptions:
    """Transfer prepared common controls without copying client or callback identities."""
    return CompletionsOptions(
        **{field.name: getattr(options, field.name) for field in fields(CallOptions)},
        reasoning_effort=options.reasoning if options.reasoning != "off" else None,
        tool_choice=options.tool_choice,
    )
