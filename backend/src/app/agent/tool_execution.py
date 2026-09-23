"""Execute one host tool call and form its AI result message."""

from __future__ import annotations

import asyncio
import time
from copy import deepcopy

from app.agent.events import AgentEvents, ToolEvent
from app.agent.hooks import AgentHooks
from app.agent.tools import AgentTool, AgentToolResult, ToolInvocation
from app.ai import JSONValue, TextContent, ToolCall, ToolResultMessage, validate_tool_arguments


def error_result(message: str) -> AgentToolResult:
    """Represent one unexecuted or failed call as model-visible content."""
    return AgentToolResult(content=[TextContent(text=message)], is_error=True)


async def execute_tool_call(
    call: ToolCall,
    tool: AgentTool | None,
    operation_id: str,
    tool_context: object | None,
    *,
    events: AgentEvents | None = None,
    hooks: AgentHooks | None = None,
    incomplete: bool = False,
) -> tuple[AgentToolResult, ToolResultMessage]:
    """Prepare, validate and run one call while preserving its original identity."""
    if events is not None:
        await events.emit(
            ToolEvent("tool_start", operation_id, call.id, call.name, deepcopy(call.arguments))
        )
    if incomplete:
        result = error_result(
            "Tool arguments may be incomplete because generation stopped at length"
        )
    elif tool is None:
        result = error_result(f'Unknown or unavailable tool "{call.name}"')
    else:
        try:
            prepared = (
                tool.prepare_arguments(call.arguments)
                if tool.prepare_arguments is not None
                else call.arguments
            )
            arguments = validate_tool_arguments(tool.definition, prepared)
        except Exception as error:
            result = error_result(str(error) or type(error).__name__)
        else:
            blocked = None
            if hooks is not None and events is not None:
                try:
                    arguments, blocked = await hooks.before(
                        tool,
                        operation_id,
                        call.id,
                        arguments,
                        tool_context,
                        events,
                    )
                except Exception as error:
                    blocked = error_result(str(error) or type(error).__name__)
            if blocked is not None:
                result = blocked
            else:
                result = await _run_tool(
                    call,
                    tool,
                    operation_id,
                    tool_context,
                    arguments,
                    events,
                    hooks,
                )
    if events is not None:
        await events.emit(
            ToolEvent(
                "tool_end",
                operation_id,
                call.id,
                call.name,
                result=deepcopy(result),
            )
        )
    return result, ToolResultMessage(
        tool_call_id=call.id,
        tool_name=call.name,
        content=result.content,
        details=result.details,
        usage=result.usage,
        is_error=result.is_error,
        timestamp=time.time_ns() // 1_000_000,
    )


async def _run_tool(
    call: ToolCall,
    tool: AgentTool,
    operation_id: str,
    tool_context: object | None,
    arguments: dict[str, JSONValue],
    events: AgentEvents | None,
    hooks: AgentHooks | None,
) -> AgentToolResult:
    """Execute and settle progress before applying post-execution hooks."""
    active = True
    pending: asyncio.Task[None] | None = None

    def on_update(partial: AgentToolResult) -> None:
        nonlocal pending
        if not active or events is None:
            return
        previous = pending
        snapshot = deepcopy(partial)

        async def deliver() -> None:
            if previous is not None:
                await previous
            await events.emit(
                ToolEvent(
                    "tool_update",
                    operation_id,
                    call.id,
                    call.name,
                    result=snapshot,
                )
            )

        pending = asyncio.create_task(deliver())

    try:
        result = await tool.execute(
            call.id,
            arguments,
            on_update,
            tool_context,
            ToolInvocation(operation_id),
        )
    except Exception as error:
        result = error_result(str(error) or type(error).__name__)
    finally:
        active = False
        if pending is not None:
            await pending
    if hooks is not None and events is not None:
        result = await hooks.after(tool, operation_id, call.id, result, tool_context, events)
    return result
