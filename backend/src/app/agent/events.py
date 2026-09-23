"""Deliver isolated, ordered in-process Agent observations."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass
from typing import Literal

from app.agent.tools import AgentToolResult
from app.ai import JSONValue

type ToolEventType = Literal["tool_start", "tool_update", "tool_end"]
type EventType = ToolEventType | Literal["handler_error"]


@dataclass(frozen=True, slots=True)
class ToolEvent:
    """One tool lifecycle observation, separate from saved conversation history."""

    type: ToolEventType
    operation_id: str
    call_id: str
    tool_name: str
    arguments: JSONValue = None
    result: AgentToolResult | None = None


@dataclass(frozen=True, slots=True)
class HandlerErrorEvent:
    """Report a failing hook or listener without changing the tool outcome."""

    source: Literal["event", "hook"]
    event_type: str
    handler_name: str
    error: str
    type: Literal["handler_error"] = "handler_error"


type AgentEvent = ToolEvent | HandlerErrorEvent
type EventListener = Callable[[AgentEvent], object | Awaitable[object]]


class AgentEvents:
    """Register listeners and isolate their received data and ordinary errors."""

    def __init__(self) -> None:
        self._listeners: dict[EventType, list[EventListener]] = {
            "tool_start": [],
            "tool_update": [],
            "tool_end": [],
            "handler_error": [],
        }

    def on(self, event_type: EventType, listener: EventListener) -> Callable[[], None]:
        """Subscribe to an event and return a function that removes this listener."""
        listeners = self._listeners[event_type]
        listeners.append(listener)

        def unsubscribe() -> None:
            if listener in listeners:
                listeners.remove(listener)

        return unsubscribe

    async def emit(self, event: AgentEvent) -> None:
        """Deliver in registration order; listener failures do not stop delivery."""
        for listener in list(self._listeners[event.type]):
            try:
                outcome = listener(deepcopy(event))
                if inspect.isawaitable(outcome):
                    await outcome
            except Exception as error:
                if event.type != "handler_error":
                    await self.handler_error("event", event.type, listener, error)

    async def handler_error(
        self,
        source: Literal["event", "hook"],
        event_type: str,
        handler: object,
        error: Exception,
    ) -> None:
        """Publish a nonrecursive handler failure record."""
        await self.emit(
            HandlerErrorEvent(
                source=source,
                event_type=event_type,
                handler_name=getattr(handler, "__name__", type(handler).__name__),
                error=str(error) or type(error).__name__,
            )
        )
