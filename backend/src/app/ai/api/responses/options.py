"""Explicit Responses options extend the shared request controls."""

from dataclasses import dataclass, fields

from app.ai.messages import JSONValue
from app.ai.options import CallOptions, SimpleOptions


@dataclass(frozen=True, kw_only=True)
class ResponsesOptions(CallOptions):
    """Request controls for the Responses protocol."""

    reasoning_effort: str | None = None
    reasoning_summary: str | None = None
    tool_choice: str | dict[str, JSONValue] | None = None
    service_tier: str | None = None


def from_simple(options: SimpleOptions) -> ResponsesOptions:
    """Transfer common controls without copying client or callback identities."""
    return ResponsesOptions(
        **{field.name: getattr(options, field.name) for field in fields(CallOptions)},
        reasoning_effort=options.reasoning if options.reasoning != "off" else None,
        tool_choice=options.tool_choice,
    )
