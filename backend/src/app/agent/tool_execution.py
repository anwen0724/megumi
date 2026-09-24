"""Execute one host tool call and form its AI result message."""

from __future__ import annotations

import asyncio
import time
from copy import deepcopy
from dataclasses import dataclass

from app.agent.events import AgentEvents, ToolEvent
from app.agent.hooks import AgentHooks
from app.agent.tools import AgentTool, AgentToolResult, ToolInvocation
from app.ai import JSONValue, TextContent, ToolCall, ToolResultMessage, validate_tool_arguments


def error_result(message: str) -> AgentToolResult:
    """Represent one unexecuted or failed call as model-visible content."""
    return AgentToolResult(content=[TextContent(text=message)], is_error=True)


@dataclass(frozen=True, slots=True)
class PreparedToolCall:
    """保存已通过参数校验和前置钩子的调用。供调度器启动执行。"""

    tool: AgentTool
    arguments: dict[str, JSONValue]


async def prepare_tool_call(
    call: ToolCall,
    tool: AgentTool | None,
    operation_id: str,
    tool_context: object | None,
    *,
    events: AgentEvents | None = None,
    hooks: AgentHooks | None = None,
    incomplete: bool = False,
) -> PreparedToolCall | AgentToolResult:
    """按调用顺序完成准备。失败或被阻止时直接形成错误结果。"""
    if incomplete:
        return error_result("Tool arguments may be incomplete because generation stopped at length")
    if tool is None:
        return error_result(f'Unknown or unavailable tool "{call.name}"')
    try:
        prepared = (
            tool.prepare_arguments(call.arguments)
            if tool.prepare_arguments is not None
            else call.arguments
        )
        arguments = validate_tool_arguments(tool, prepared)
        if hooks is not None and events is not None:
            replacement, blocked = await hooks.before(
                tool, operation_id, call.id, arguments, tool_context, events
            )
            if blocked is not None:
                return blocked
            arguments = validate_tool_arguments(tool, replacement)
    except Exception as error:
        return error_result(str(error) or type(error).__name__)
    if events is not None:
        # 准备成功后发布实际执行参数。监听结束后调度器才能启动工具。
        await events.emit(
            ToolEvent("tool_start", operation_id, call.id, call.name, deepcopy(arguments))
        )
    return PreparedToolCall(tool, arguments)


async def execute_tool_call(
    call: ToolCall,
    prepared: PreparedToolCall | AgentToolResult,
    operation_id: str,
    tool_context: object | None,
    *,
    events: AgentEvents | None = None,
    hooks: AgentHooks | None = None,
) -> tuple[AgentToolResult, ToolResultMessage]:
    """执行已获准的调用。或发布准备阶段产生的结果。不重复运行前置钩子。"""
    if isinstance(prepared, AgentToolResult) and events is not None:
        # 未执行分支在错误结果确定后补发 start。参数仍为模型原始输入。
        await events.emit(
            ToolEvent("tool_start", operation_id, call.id, call.name, deepcopy(call.arguments))
        )
    result = (
        await _run_tool(
            call, prepared.tool, operation_id, tool_context, prepared.arguments, events, hooks
        )
        if isinstance(prepared, PreparedToolCall)
        else prepared
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
        result = await hooks.after(
            tool, operation_id, call.id, arguments, result, tool_context, events
        )
    return result
