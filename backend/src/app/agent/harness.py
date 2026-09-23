"""Accept conversation input and advance one model request to its result."""

from __future__ import annotations

import asyncio

from app.agent.operation import BusyResult, OperationRecord, OperationResult
from app.agent.session import Session, SessionSnapshot
from app.agent.tool_execution import execute_tool_call
from app.agent.tools import AgentTool
from app.ai import Model, Models, ToolCall


class AgentHarness:
    """Own one session's admitted work while sharing the host's Models runtime."""

    def __init__(
        self,
        models: Models,
        model: Model,
        system_prompt: str | None = None,
        *,
        tools: list[AgentTool] | None = None,
        active_tool_names: list[str] | None = None,
        tool_context: object | None = None,
    ) -> None:
        self._models = models
        self._model = model
        self._system_prompt = system_prompt
        self._tools = {tool.definition.name: tool for tool in tools or []}
        if len(self._tools) != len(tools or []):
            raise ValueError("duplicate tool name")
        self._active_tool_names = (
            list(self._tools) if active_tool_names is None else list(active_tool_names)
        )
        self._tool_context = tool_context
        self._session = Session()
        self._active_task: asyncio.Task[OperationResult] | None = None

    async def prompt(self, text: str) -> OperationResult | BusyResult:
        """Accept and drive one text input; leaving a wait does not stop owned work."""
        if self._session.active_operation_id is not None:
            return BusyResult()
        record = self._session.accept(text)
        task = asyncio.create_task(self._drive(record))
        self._active_task = task
        return await asyncio.shield(task)

    def get_snapshot(self) -> SessionSnapshot:
        """Read this session's stored messages and operation results."""
        return self._session.snapshot()

    async def _drive(self, record: OperationRecord) -> OperationResult:
        """Advance assistant and tool calls in one admitted operation."""
        try:
            while True:
                missing = [name for name in self._active_tool_names if name not in self._tools]
                if missing:
                    raise ValueError(f"enabled tool is not registered: {missing[0]}")
                enabled = {name: self._tools[name] for name in self._active_tool_names}
                context = self._session.context(
                    self._system_prompt, [tool.definition for tool in enabled.values()]
                )
                record.phase = "assistant.effect_pending"
                response = self._models.stream_simple(self._model, context)
                async for _event in response:
                    pass
                final = await response.result()
                calls = [block for block in final.content if isinstance(block, ToolCall)]
                if calls and final.stop_reason in {"tool_use", "stop"}:
                    self._session.append_message(final)
                    for call in calls:
                        tool = enabled[call.name]
                        _result, message = await execute_tool_call(
                            call, tool, record.operation_id, self._tool_context
                        )
                        self._session.append_message(message)
                    continue
                completed = final.stop_reason in {"stop", "length"} and not calls
                result = OperationResult(
                    operation_id=record.operation_id,
                    status="completed" if completed else "failed",
                    assistant_message=final,
                    error_message=None
                    if completed
                    else (final.error_message or f"Assistant ended with {final.stop_reason}"),
                )
                self._session.settle(record, result)
                break
        except Exception as error:
            result = OperationResult(
                operation_id=record.operation_id,
                status="failed",
                error_message=str(error) or type(error).__name__,
            )
            self._session.settle(record, result)
        finally:
            self._session.release(record)
            self._active_task = None
        return result
