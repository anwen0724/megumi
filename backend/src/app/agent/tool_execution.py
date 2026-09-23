"""Execute one validated host tool call and form its AI result message."""

from __future__ import annotations

import time

from app.agent.tools import AgentTool, AgentToolResult, ToolInvocation
from app.ai import ToolCall, ToolResultMessage, validate_tool_arguments


async def execute_tool_call(
    call: ToolCall,
    tool: AgentTool,
    operation_id: str,
    tool_context: object | None,
) -> tuple[AgentToolResult, ToolResultMessage]:
    """Run one declared tool with validated arguments and preserve its call ID."""
    arguments = validate_tool_arguments(tool.definition, call.arguments)
    result = await tool.execute(
        call.id, arguments, lambda _partial: None, tool_context, ToolInvocation(operation_id)
    )
    return result, ToolResultMessage(
        tool_call_id=call.id,
        tool_name=call.name,
        content=result.content,
        details=result.details,
        usage=result.usage,
        is_error=False,
        timestamp=time.time_ns() // 1_000_000,
    )
