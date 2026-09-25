"""Project durable session history into model context and public snapshots."""

from __future__ import annotations

import time
from dataclasses import dataclass
from uuid import uuid4

from app.agent.operation import OperationRecord, OperationResult
from app.agent.persistence import SQLiteStore
from app.agent.persistence.operation_state import (
    AssistantPendingState,
    CheckpointState,
    GenerationConfiguration,
    GenerationContext,
    MayFinish,
    NeedAssistant,
    OperationSettings,
    OperationState,
    ToolBatch,
    ToolsState,
)
from app.agent.persistence.records import HistoryEntry, OperationInfo
from app.ai import AssistantMessage, Context, Message, Model, Tool, UserMessage


@dataclass(frozen=True, slots=True)
class SessionSnapshot:
    """An independent view of saved history and operation results."""

    session_id: str
    messages: list[Message]
    operations: list[OperationRecord]
    active_operation_id: str | None


class Session:
    """Bind one conversation identity to its host-owned storage."""

    def __init__(self, store: SQLiteStore | None = None, session_id: str | None = None) -> None:
        self.store = store if store is not None else SQLiteStore(":memory:")
        self.session_id = (
            self.store.get_session(session_id).id
            if session_id is not None
            else self.store.create_session().id
        )

    @property
    def active_operation_id(self) -> str | None:
        """Read the durable owner rather than a separately mutable memory flag."""
        operation = self.store.active_operation(self.session_id)
        return operation.id if operation else None

    def accept(self, text: str, *, settings: OperationSettings | None = None) -> OperationRecord:
        """Save the user input and claim before starting any external action."""
        message = UserMessage(content=text, timestamp=time.time_ns() // 1_000_000)
        operation = self.store.accept_operation(self.session_id, [message], settings=settings)
        return self._record(operation)

    def context(self, system_prompt: str | None, tools: list[Tool] | None = None) -> Context:
        """Project full settled history using the existing failed-assistant filter."""
        visible = [
            entry.message
            for entry in self.store.list_entries(self.session_id)
            if entry.message is not None
            and not (
                isinstance(entry.message, AssistantMessage)
                and entry.message.stop_reason in {"error", "aborted"}
            )
        ]
        return Context(messages=visible, system_prompt=system_prompt, tools=tools)

    def begin_response(
        self,
        record: OperationRecord,
        model: Model,
        active_tool_names: list[str],
    ) -> AssistantPendingState:
        """Commit a request identity before Models starts its background producer."""
        operation = self.store.get_operation(record.operation_id)
        assert operation.state is not None
        entries = self.store.list_entries(self.session_id)
        state = AssistantPendingState(
            settings=operation.state.settings,
            control=operation.state.control,
            latest_assistant_entry_id=operation.state.latest_assistant_entry_id,
            generation_context=GenerationContext(
                step_id=str(uuid4()),
                trigger_entry_id=entries[-1].id if entries else None,
                configuration=GenerationConfiguration(
                    provider=model.provider,
                    model_id=model.id,
                    active_tool_names=active_tool_names,
                ),
            ),
            attempt=1,
            response_entry_id=str(uuid4()),
            usage_id=str(uuid4()),
            intended_output_limit=model.max_output_tokens,
            context_window=model.context_window,
        )
        self.store.transition(operation.id, expected=operation.state, state=state)
        return state

    def record_response(
        self,
        record: OperationRecord,
        state: AssistantPendingState,
        message: AssistantMessage,
        *,
        needs_tools: bool,
    ) -> None:
        """Save each assistant exactly once, independently of operation settlement."""
        next_state: OperationState = CheckpointState(
            settings=state.settings,
            control=state.control,
            latest_assistant_entry_id=state.response_entry_id,
            continuation=NeedAssistant() if needs_tools else MayFinish(),
            trigger_entry_id=state.response_entry_id,
        )
        if needs_tools:
            next_state = ToolsState(
                settings=state.settings,
                control=state.control,
                latest_assistant_entry_id=state.response_entry_id,
                batch=ToolBatch(
                    assistant_entry_id=state.response_entry_id,
                    configuration=state.generation_context.configuration,
                    turn_id=state.generation_context.step_id,
                ),
            )
        self.store.commit_response(
            record.operation_id,
            expected=state,
            message=message,
            next_state=next_state,
        )

    def append_message(self, message: Message) -> None:
        """Append settled tool output for the current admitted operation."""
        operation = self.store.active_operation(self.session_id)
        assert operation is not None
        self.store.append_operation_message(operation.id, message, expected=operation.state)

    def settle(self, record: OperationRecord, result: OperationResult) -> None:
        """Save a terminal result; its assistant, if any, is already in history."""
        operation = self.store.get_operation(record.operation_id)
        self.store.finish_operation(
            operation.id,
            expected=operation.state,
            status=result.status,
            error={"code": "run_failed", "message": result.error_message or "Run failed"}
            if result.status == "failed"
            else None,
        )

    def release(self, record: OperationRecord) -> None:
        """Persist release after the saved result and synchronous Agent teardown."""
        self.store.release_operation(record.operation_id)

    def _record(
        self,
        operation: OperationInfo,
        entries: list[HistoryEntry] | None = None,
    ) -> OperationRecord:
        """Build the existing public result from facts without an extra result pointer."""
        entries = self.store.list_entries(self.session_id) if entries is None else entries
        owned = [entry for entry in entries if entry.operation_id == operation.id]
        result = None
        if operation.result_status is not None:
            final = next((entry for entry in entries if entry.id == operation.final_entry_id), None)
            assistant = (
                final.message
                if final is not None
                and final.operation_id == operation.id
                and isinstance(final.message, AssistantMessage)
                else None
            )
            result = OperationResult(
                operation_id=operation.id,
                status=operation.result_status,
                assistant_message=assistant,
                error_message=str(operation.error["message"]) if operation.error else None,
            )
        return OperationRecord(
            operation_id=operation.id,
            input_index=owned[0].seq if owned else len(entries),
            phase="finished"
            if operation.released_at is not None
            else (
                "result_recorded"
                if result
                else operation.state.at
                if operation.state
                else "starting"
            ),
            result=result,
        )

    def snapshot(self) -> SessionSnapshot:
        """Return one transactionally consistent, independent public view."""
        data = self.store.read_session(self.session_id)
        return SessionSnapshot(
            self.session_id,
            [entry.message for entry in data.entries if entry.message is not None],
            [self._record(op, data.entries) for op in data.operations],
            next((op.id for op in data.operations if op.released_at is None), None),
        )
