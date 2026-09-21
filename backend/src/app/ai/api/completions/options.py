"""Explicit Chat Completions options share common call controls."""

from dataclasses import dataclass

from app.ai.options import CallOptions


@dataclass(frozen=True, kw_only=True)
class CompletionsOptions(CallOptions):
    """Options for the Chat Completions protocol."""
