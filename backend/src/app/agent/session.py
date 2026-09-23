"""Hold in-memory conversation history and readable operation snapshots."""

from __future__ import annotations

import time
from copy import deepcopy
from dataclasses import dataclass
from uuid import uuid4

from app.agent.operation import OperationRecord, OperationResult
from app.ai import AssistantMessage, Context, Message, ToolDefinition, UserMessage


@dataclass(frozen=True, slots=True)
class SessionSnapshot:
    """An independent view of a session's history and operation records."""

    session_id: str
    messages: list[Message]
    operations: list[OperationRecord]
    active_operation_id: str | None


class Session:
    """Own history and the active operation for one conversation."""

    def __init__(self) -> None:
        self.session_id = str(uuid4())
        self.messages: list[Message] = []
        self.operations: list[OperationRecord] = []
        self.active_operation_id: str | None = None

    def accept(self, text: str) -> OperationRecord:
        """Record one user input and claim this session before any await."""
        message = UserMessage(content=text, timestamp=time.time_ns() // 1_000_000)
        record = OperationRecord(operation_id=str(uuid4()), input_index=len(self.messages))
        self.messages.append(message)
        self.operations.append(record)
        self.active_operation_id = record.operation_id
        return record

    def context(
        self, system_prompt: str | None, tools: list[ToolDefinition] | None = None
    ) -> Context:
        """Project saved conversation history into one independent AI request."""
        visible = [
            message
            for message in self.messages
            if not (
                isinstance(message, AssistantMessage)
                and message.stop_reason in {"error", "aborted"}
            )
        ]
        return Context(
            messages=deepcopy(visible), system_prompt=system_prompt, tools=deepcopy(tools)
        )

    def append_message(self, message: Message) -> None:
        """Record one settled assistant or tool result without ending the operation."""
        self.messages.append(deepcopy(message))

    def settle(self, record: OperationRecord, result: OperationResult) -> None:
        """Save the final AI message and operation outcome."""
        if result.assistant_message is not None:
            self.messages.append(deepcopy(result.assistant_message))
        record.result = deepcopy(result)
        record.phase = "result_recorded"

    def release(self, record: OperationRecord) -> None:
        """Clear the active claim after the operation has settled."""
        record.phase = "finished"
        self.active_operation_id = None

    def snapshot(self) -> SessionSnapshot:
        """Return data that a caller cannot mutate back into the stored session."""
        return SessionSnapshot(
            session_id=self.session_id,
            messages=deepcopy(self.messages),
            operations=deepcopy(self.operations),
            active_operation_id=self.active_operation_id,
        )
