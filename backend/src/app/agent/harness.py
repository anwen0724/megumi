"""Accept conversation input and advance one model request to its result."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from typing import Literal

from app.agent.events import AgentEvents
from app.agent.hooks import AgentHooks
from app.agent.operation import BusyResult, OperationRecord, OperationResult
from app.agent.persistence.errors import BusyError, StorageError
from app.agent.persistence.operation_state import OperationSettings, ToolsState
from app.agent.session import Session, SessionSnapshot
from app.agent.tool_execution import PreparedToolCall, execute_tool_call, prepare_tool_call
from app.agent.tools import AgentTool, AgentToolResult, ToolInvocation
from app.ai import (
    AssistantMessageFrameEncoder,
    Model,
    Models,
    ToolCall,
    ToolResultMessage,
    to_tool_declaration,
)


class AgentHarness:
    """Own one session's admitted work while sharing the host's Models runtime."""

    def __init__(
        self,
        models: Models,
        model: Model,
        system_prompt: str | None = None,
        *,
        session: Session | None = None,
        tools: list[AgentTool] | None = None,
        active_tool_names: list[str] | None = None,
        tool_context: object | None = None,
        tool_execution: Literal["sequential", "parallel"] = "parallel",
    ) -> None:
        self._models = models
        self._model = model
        self._system_prompt = system_prompt
        self._tools = {
            tool.name: AgentTool(
                name=tool.name,
                description=tool.description,
                parameters=deepcopy(tool.parameters),
                constrained_sampling=deepcopy(tool.constrained_sampling),
                execute=tool.execute,
                prepare_arguments=tool.prepare_arguments,
                replay_policy=tool.replay_policy,
            )
            for tool in tools or []
        }
        if len(self._tools) != len(tools or []):
            raise ValueError("duplicate tool name")
        self._active_tool_names = (
            list(self._tools) if active_tool_names is None else list(active_tool_names)
        )
        if tool_execution not in {"sequential", "parallel"}:
            raise ValueError(f"unsupported tool execution mode: {tool_execution}")
        self._tool_execution = tool_execution
        self._tool_context = tool_context
        self.events = AgentEvents()
        self.hooks = AgentHooks()
        self._session = session if session is not None else Session()
        self._active_task: asyncio.Task[OperationResult] | None = None

    async def prompt(self, text: str) -> OperationResult | BusyResult:
        """Accept and drive one text input; leaving a wait does not stop owned work."""
        if self._session.active_operation_id is not None:
            return BusyResult()
        try:
            record = self._session.accept(
                text, settings=OperationSettings(tool_execution=self._tool_execution)
            )
        except BusyError:
            return BusyResult()
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
                    self._system_prompt, [to_tool_declaration(tool) for tool in enabled.values()]
                )
                request_state = self._session.begin_response(record, self._model, list(enabled))
                response = self._models.stream_simple(self._model, context)
                encoder = AssistantMessageFrameEncoder()
                try:
                    async for event in response:
                        frame = encoder.encode(event)
                        if frame is not None:
                            self._session.store.append_frame(
                                record.operation_id,
                                request_state.response_entry_id,
                                frame,
                            )
                except BaseException:
                    response.cancel()
                    raise
                final = await response.result()
                calls = [block for block in final.content if isinstance(block, ToolCall)]
                needs_tools = bool(calls) and final.stop_reason in {"tool_use", "stop", "length"}
                self._session.record_response(record, request_state, final, needs_tools=needs_tools)
                if needs_tools:
                    batch_results = await self._execute_batch(
                        calls,
                        enabled,
                        record.operation_id,
                        incomplete=final.stop_reason == "length",
                    )
                    if all(item.terminate for item in batch_results):
                        result = OperationResult(
                            operation_id=record.operation_id, status="completed"
                        )
                        self._session.settle(record, result)
                        break
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
        except StorageError:
            raise
        except Exception as error:
            result = OperationResult(
                operation_id=record.operation_id,
                status="failed",
                error_message=str(error) or type(error).__name__,
            )
            self._session.settle(record, result)
        finally:
            self._active_task = None
        self._session.release(record)
        return result

    async def _execute_batch(
        self,
        calls: list[ToolCall],
        enabled: dict[str, AgentTool],
        operation_id: str,
        *,
        incomplete: bool,
    ) -> list[AgentToolResult]:
        """Run one batch and place settled results in the model's call order."""

        operation = self._session.store.get_operation(operation_id)
        assert isinstance(operation.state, ToolsState)
        invocations = self._session.store.list_tools(
            operation_id, assistant_entry_id=operation.state.batch.assistant_entry_id
        )

        async def prepare(call: ToolCall) -> PreparedToolCall | AgentToolResult:
            return await prepare_tool_call(
                call,
                enabled.get(call.name),
                operation_id,
                self._tool_context,
                events=self.events,
                hooks=self.hooks,
                incomplete=incomplete,
            )

        async def run(
            index: int, call: ToolCall, prepared: PreparedToolCall | AgentToolResult
        ) -> tuple[AgentToolResult, ToolResultMessage]:
            invocation = invocations[index]
            if isinstance(prepared, PreparedToolCall):
                self._session.store.start_tool(
                    invocation.id, prepared.arguments, prepared.tool.replay_policy
                )
            result, message = await execute_tool_call(
                call,
                prepared,
                operation_id,
                self._tool_context,
                invocation=ToolInvocation(operation_id, self._session.store, invocation.id),
                events=self.events,
                hooks=self.hooks,
            )
            self._session.store.save_tool_outcome(
                invocation.id, message, terminate=result.terminate
            )
            self._session.store.publish_tool_results(operation_id)
            return result, message

        results: list[AgentToolResult] = []
        if self._tool_execution == "sequential":
            for index, call in enumerate(calls):
                result, _message = await run(index, call, await prepare(call))
                results.append(result)
            return results

        settled: list[tuple[AgentToolResult, ToolResultMessage] | None] = [None] * len(calls)
        next_index = 0

        async def run_and_place(
            index: int,
            call: ToolCall,
            prepared: PreparedToolCall | AgentToolResult,
            started: asyncio.Event,
        ) -> None:
            nonlocal next_index
            # 通知调度器已进入执行阶段。下一项准备无需等待本次执行完成。
            started.set()
            settled[index] = await run(index, call, prepared)
            # 后续调用仍在等待前置钩子时。已完成的前缀也可以立即进入历史。
            # 此处没有 await。因此多个任务不会交错修改回填位置。
            while next_index < len(settled) and settled[next_index] is not None:
                item = settled[next_index]
                assert item is not None
                result, _message = item
                results.append(result)
                next_index += 1

        tasks: list[asyncio.Task[None]] = []
        try:
            for index, call in enumerate(calls):
                prepared = await prepare(call)
                started = asyncio.Event()
                tasks.append(asyncio.create_task(run_and_place(index, call, prepared, started)))
                await started.wait()
            # 普通工具异常已转为错误结果。框架异常在其他已启动任务结束后上抛。
            outcomes = await asyncio.gather(*tasks, return_exceptions=True)
            for outcome in outcomes:
                if isinstance(outcome, BaseException):
                    raise outcome
            return results
        finally:
            await asyncio.gather(*tasks, return_exceptions=True)
