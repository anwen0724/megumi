"""Accept conversation input and advance one model request through cleanup."""

from __future__ import annotations

import asyncio

from app.agent.operation import BusyResult, OperationRecord, OperationResult
from app.agent.session import Session, SessionSnapshot
from app.ai import AssistantResponse, Model, Models


class AgentHarness:
    """Own one session's admitted work while sharing the host's Models runtime."""

    def __init__(self, models: Models, model: Model, system_prompt: str | None = None) -> None:
        self._models = models
        self._model = model
        self._system_prompt = system_prompt
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
        """Run the normal generation stage and settle it before response cleanup."""
        response: AssistantResponse | None = None
        try:
            context = self._session.context(self._system_prompt)
            record.phase = "assistant.effect_pending"
            response = self._models.stream_simple(self._model, context)
            async for _event in response:
                pass
            final = await response.result()
            completed = final.stop_reason in {"stop", "length"} and not any(
                block.type == "toolCall" for block in final.content
            )
            result = OperationResult(
                operation_id=record.operation_id,
                status="completed" if completed else "failed",
                assistant_message=final,
                error_message=None
                if completed
                else (final.error_message or f"Assistant ended with {final.stop_reason}"),
            )
            self._session.settle(record, result)
        except Exception as error:
            result = OperationResult(
                operation_id=record.operation_id,
                status="failed",
                error_message=str(error) or type(error).__name__,
            )
            self._session.settle(record, result)
        finally:
            try:
                if response is not None:
                    await response.aclose()
            finally:
                self._session.release(record)
                self._active_task = None
        return result
