"""Define host tools and results without exposing execution to the AI layer."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.ai import InputContent, JSONValue, Tool, Usage


@dataclass(frozen=True, slots=True)
class ToolInvocation:
    """Identify the admitted operation that owns one tool call."""

    operation_id: str


@dataclass(kw_only=True)
class AgentToolResult:
    """Separate model-visible content from execution details and control."""

    content: list[InputContent]
    details: JSONValue = None
    usage: Usage | None = None
    terminate: bool = False
    is_error: bool = False


type ToolUpdate = Callable[[AgentToolResult], None]
type ToolExecute = Callable[
    [str, dict[str, JSONValue], ToolUpdate, object | None, ToolInvocation],
    Awaitable[AgentToolResult],
]


@dataclass(kw_only=True)
class AgentTool(Tool):
    """Extend model-visible tool fields with host-owned execution."""

    execute: ToolExecute
    prepare_arguments: Callable[[JSONValue], JSONValue] | None = None
