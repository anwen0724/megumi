"""Execute one host tool call and form its AI result message."""

from __future__ import annotations

import time

from app.agent.tools import AgentTool, AgentToolResult, ToolInvocation
from app.ai import TextContent, ToolCall, ToolResultMessage, validate_tool_arguments


def error_result(message: str) -> AgentToolResult:
    """Represent one unexecuted or failed call as model-visible content."""
    return AgentToolResult(content=[TextContent(text=message)], is_error=True)


async def execute_tool_call(
    call: ToolCall,
    tool: AgentTool | None,
    operation_id: str,
    tool_context: object | None,
    *,
    incomplete: bool = False,
) -> tuple[AgentToolResult, ToolResultMessage]:
    """Prepare, validate and run one call while preserving its original identity."""
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
            try:
                result = await tool.execute(
                    call.id,
                    arguments,
                    lambda _partial: None,
                    tool_context,
                    ToolInvocation(operation_id),
                )
            except Exception as error:
                result = error_result(str(error) or type(error).__name__)
    return result, ToolResultMessage(
        tool_call_id=call.id,
        tool_name=call.name,
        content=result.content,
        details=result.details,
        usage=result.usage,
        is_error=result.is_error,
        timestamp=time.time_ns() // 1_000_000,
    )
