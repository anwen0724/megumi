"""Represent deliberate tool execution interventions."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass
from typing import Literal

from app.agent.events import AgentEvents
from app.agent.tools import AgentTool, AgentToolResult
from app.ai import InputContent, JSONValue, TextContent, Usage, validate_tool_arguments


class _Unchanged:
    """Distinguish an omitted patch field from an explicit None value."""


UNCHANGED = _Unchanged()


@dataclass(kw_only=True)
class BeforeToolDecision:
    """Replace call arguments or prevent execution with a model-visible reason."""

    arguments: JSONValue | _Unchanged = UNCHANGED
    block_reason: str | None = None
    terminate: bool = False


@dataclass(kw_only=True)
class AfterToolPatch:
    """Change selected final result fields without undoing the action."""

    content: list[InputContent] | _Unchanged = UNCHANGED
    details: JSONValue | _Unchanged = UNCHANGED
    usage: Usage | _Unchanged | None = UNCHANGED
    is_error: bool | _Unchanged = UNCHANGED
    terminate: bool | _Unchanged = UNCHANGED


@dataclass(frozen=True, slots=True)
class BeforeToolContext:
    """Call identity and currently validated arguments for a before hook."""

    operation_id: str
    call_id: str
    tool_name: str
    arguments: dict[str, JSONValue]
    tool_context: object | None


@dataclass(frozen=True, slots=True)
class AfterToolContext:
    """Call identity and accumulated result for an after hook."""

    operation_id: str
    call_id: str
    tool_name: str
    result: AgentToolResult
    tool_context: object | None


type HookType = Literal["before_tool", "after_tool"]
type HookHandler = Callable[[object], object | Awaitable[object]]


class AgentHooks:
    """Hold registered execution hooks in their registration order."""

    def __init__(self) -> None:
        self._handlers: dict[HookType, list[HookHandler]] = {
            "before_tool": [],
            "after_tool": [],
        }

    def on(self, kind: HookType, handler: HookHandler) -> Callable[[], None]:
        """Register a hook and return its removal function."""
        handlers = self._handlers[kind]
        handlers.append(handler)

        def unsubscribe() -> None:
            if handler in handlers:
                handlers.remove(handler)

        return unsubscribe

    async def before(
        self,
        tool: AgentTool,
        operation_id: str,
        call_id: str,
        arguments: dict[str, JSONValue],
        tool_context: object | None,
        events: AgentEvents,
    ) -> tuple[dict[str, JSONValue], AgentToolResult | None]:
        """Apply ordered decisions and revalidate each replacement."""
        current = arguments
        for handler in list(self._handlers["before_tool"]):
            context = BeforeToolContext(
                operation_id,
                call_id,
                tool.definition.name,
                deepcopy(current),
                tool_context,
            )
            try:
                decision = handler(context)
                if inspect.isawaitable(decision):
                    decision = await decision
            except Exception as error:
                await events.handler_error("hook", "before_tool", handler, error)
                return current, AgentToolResult(
                    content=[TextContent(text=str(error) or type(error).__name__)],
                    is_error=True,
                )
            if decision is None:
                continue
            if not isinstance(decision, BeforeToolDecision):
                invalid_decision = TypeError("before_tool must return BeforeToolDecision or None")
                await events.handler_error("hook", "before_tool", handler, invalid_decision)
                return current, AgentToolResult(
                    content=[TextContent(text=str(invalid_decision))], is_error=True
                )
            if decision.block_reason is not None:
                return current, AgentToolResult(
                    content=[TextContent(text=decision.block_reason)],
                    is_error=True,
                    terminate=decision.terminate,
                )
            if not isinstance(decision.arguments, _Unchanged):
                current = validate_tool_arguments(tool.definition, decision.arguments)
        return current, None

    async def after(
        self,
        tool: AgentTool,
        operation_id: str,
        call_id: str,
        result: AgentToolResult,
        tool_context: object | None,
        events: AgentEvents,
    ) -> AgentToolResult:
        """Apply successful patches while reporting and skipping failed handlers."""
        current = result
        for handler in list(self._handlers["after_tool"]):
            context = AfterToolContext(
                operation_id,
                call_id,
                tool.definition.name,
                deepcopy(current),
                tool_context,
            )
            try:
                patch = handler(context)
                if inspect.isawaitable(patch):
                    patch = await patch
                if patch is None:
                    continue
                if not isinstance(patch, AfterToolPatch):
                    raise TypeError("after_tool must return AfterToolPatch or None")
                for field_name in ("content", "details", "usage", "is_error", "terminate"):
                    value = getattr(patch, field_name)
                    if not isinstance(value, _Unchanged):
                        setattr(current, field_name, deepcopy(value))
            except Exception as error:
                await events.handler_error("hook", "after_tool", handler, error)
        return current
