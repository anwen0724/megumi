"""Define typed durable records returned by Agent storage."""

from dataclasses import dataclass
from typing import Literal

from pydantic import Field

from app.agent.persistence.operation_state import CompactionSettings, OperationState, StateValue
from app.ai import JSONValue, Message, ToolResultMessage, Usage, UsageCost


@dataclass(frozen=True, slots=True)
class SessionInfo:
    """Session management data, independent of a running operation."""

    id: str
    name: str | None
    created_at: int
    last_activity_at: int
    archived_at: int | None


type ResultStatus = Literal["completed", "declined", "aborted", "failed"]


@dataclass(frozen=True, slots=True)
class HistoryEntry:
    """An immutable identity and ordered payload in a session history."""

    id: str
    session_id: str
    operation_id: str | None
    seq: int
    type: Literal["message", "custom", "compaction"]
    payload: dict[str, JSONValue]
    recorded_at: int
    message: Message | None = None


@dataclass(frozen=True, slots=True)
class OperationInfo:
    """A consistent saved lifecycle view, independent of runtime tasks."""

    id: str
    session_id: str | None
    kind: Literal["run", "compaction"]
    intent: dict[str, JSONValue] | None
    state: OperationState | None
    base_entry_id: str | None
    final_entry_id: str | None
    result_status: ResultStatus | None
    error: dict[str, JSONValue] | None
    accepted_at: int
    ended_at: int | None
    released_at: int | None


@dataclass(frozen=True, slots=True)
class UsageEntry:
    """One stable usage fact or explicit supplement, in commit order."""

    id: str
    session_id: str | None
    operation_id: str | None
    entry_id: str | None
    seq: int | None
    usage: Usage
    adjustment: bool
    details: JSONValue


@dataclass(frozen=True, slots=True)
class UsageSummary:
    """Conservative token totals and separate currency totals."""

    tokens: Usage
    costs: dict[str, UsageCost]
    has_unknown_cost: bool


@dataclass(frozen=True, slots=True)
class SessionData:
    """History and operations read together at one committed database snapshot."""

    session: SessionInfo
    entries: list[HistoryEntry]
    operations: list[OperationInfo]


@dataclass(frozen=True, slots=True)
class ToolExecutionInfo:
    """Transient tool state, tied to one source content position and future result ID."""

    id: str
    session_id: str | None
    operation_id: str
    assistant_entry_id: str
    source_index: int
    status: Literal["planned", "effect_pending", "outcome_ready", "completed"]
    arguments: dict[str, JSONValue] | None
    replay_policy: Literal["never", "safe"] | None
    partial_result: JSONValue
    memos: dict[str, JSONValue]
    pending_result: ToolResultMessage | None
    terminate: bool | None


type InputKind = Literal["steer", "follow_up", "next_run", "write"]


@dataclass(frozen=True, slots=True)
class PendingInput:
    """An accepted input not yet moved into formal session history."""

    id: str
    session_id: str
    kind: InputKind
    seq: int
    payload: dict[str, JSONValue]
    queued_at: int


class FileOperations(StateValue):
    """File paths already identified when building the preparation."""

    read: list[str] = Field(default_factory=list)
    written: list[str] = Field(default_factory=list)
    edited: list[str] = Field(default_factory=list)


class CompactionPreparation(StateValue):
    """Full immutable input snapshot; no truncation or history-only references."""

    messages_to_summarize: list[Message]
    turn_prefix_messages: list[Message]
    retained_tail: list[Message]
    is_split_turn: bool
    tokens_before: int = Field(ge=0)
    previous_summary: str | None = None
    file_ops: FileOperations = Field(default_factory=FileOperations)
    settings: CompactionSettings


@dataclass(frozen=True, slots=True)
class PreparationInfo:
    """Identity and ownership are distinct from the future summary entry."""

    id: str
    session_id: str | None
    operation_id: str
    preparation: CompactionPreparation


class CompactionRecord(StateValue):
    """Permanent summary and retained messages, separate from temporary preparation."""

    summary: str
    retained_tail: list[Message]
    tokens_before: int = Field(ge=0)
    details: JSONValue = None
    usage: Usage | None = None
    from_hook: bool


class MessageRecord(StateValue):
    """Formal message wrapper; termination metadata applies only to tool results."""

    message: Message
    terminate: bool = False


class CustomRecord(StateValue):
    """Application-owned history which is not implicitly a model message."""

    custom_type: str
    data: JSONValue = None
