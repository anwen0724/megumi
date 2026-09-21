"""Explicit Responses options extend the shared request controls."""

from dataclasses import dataclass, fields

from app.ai.options import CallOptions, SimpleOptions


@dataclass(frozen=True, kw_only=True)
class ResponsesOptions(CallOptions):
    """Request controls for the Responses protocol."""


def from_simple(options: SimpleOptions) -> ResponsesOptions:
    """Transfer common controls without copying client or callback identities."""
    return ResponsesOptions(
        **{field.name: getattr(options, field.name) for field in fields(CallOptions)}
    )
