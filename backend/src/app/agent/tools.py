"""Define host tools and results without exposing execution to the AI layer."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

from app.agent.persistence.errors import StaleWriteError

if TYPE_CHECKING:
    from app.agent.persistence.store import SQLiteStore

from app.ai import InputContent, JSONValue, Tool, Usage


@dataclass(frozen=True, slots=True)
class ToolInvocation:
    """Identify the admitted operation that owns one tool call."""

    operation_id: str
    _store: SQLiteStore | None = field(default=None, repr=False, compare=False)
    _tool_id: str | None = field(default=None, repr=False, compare=False)
    _active: bool = field(default=True, repr=False, compare=False)

    def _scope(self) -> tuple[SQLiteStore, str]:
        """Reject use after the execute callback has returned, even before publication."""
        if not self._active or self._store is None or self._tool_id is None:
            raise StaleWriteError("Tool persistence handle is inactive")
        return self._store, self._tool_id

    def _close(self) -> None:
        """Invalidate the invocation before post-execution hooks are invoked."""
        object.__setattr__(self, "_active", False)

    def checkpoint(self, partial: AgentToolResult) -> None:
        """Persist the latest explicitly selected partial result before returning."""
        store, tool_id = self._scope()
        store.checkpoint_tool(tool_id, partial)

    def get_memo(self, name: str) -> JSONValue:
        """Read this invocation's saved memo independently of the returned object."""
        store, tool_id = self._scope()
        return store.get_tool_memo(tool_id, name)

    def set_memo(self, name: str, value: JSONValue) -> None:
        """Save one memo without replacing unrelated concurrently written keys."""
        store, tool_id = self._scope()
        store.set_tool_memo(tool_id, name, value)

    def delete_memo(self, name: str) -> None:
        """Remove one memo from this active invocation."""
        store, tool_id = self._scope()
        store.delete_tool_memo(tool_id, name)


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
    replay_policy: Literal["never", "safe"] = "never"
