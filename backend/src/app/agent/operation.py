"""Represent one admitted Agent operation and its settled outcome."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.agent.persistence.records import ResultStatus
from app.ai import AssistantMessage

type OperationStatus = ResultStatus


@dataclass(frozen=True, slots=True)
class OperationResult:
    """One admitted operation's outcome, including a full AI message when available."""

    operation_id: str
    status: OperationStatus
    assistant_message: AssistantMessage | None = None
    error_message: str | None = None


@dataclass(frozen=True, slots=True)
class BusyResult:
    """A submission declined before it becomes an operation."""

    reason: Literal["busy"] = "busy"


@dataclass(slots=True)
class OperationRecord:
    """Track the input, current stage, and result of one admitted operation."""

    operation_id: str
    input_index: int
    phase: str = "accepted"
    result: OperationResult | None = None
