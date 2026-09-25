"""Represent validated durable Operation phases, without driving execution."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StateValue(BaseModel):
    """Reject unknown fields and implicit coercion in stored control data."""

    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class CompactionSettings(StateValue):
    """Capture the chosen compression settings; disabled in the current driver."""

    enabled: bool = False
    reserve_tokens: int = Field(default=0, ge=0)
    keep_recent_tokens: int = Field(default=0, ge=0)


class OperationSettings(StateValue):
    """Persist options separately from live tools and host resources."""

    compaction: CompactionSettings = Field(default_factory=CompactionSettings)
    steering_mode: Literal["all", "one"] = "all"
    follow_up_mode: Literal["all", "one"] = "all"
    tool_execution: Literal["sequential", "parallel"] = "parallel"


class RunningControl(StateValue):
    """The admitted operation may continue to its next boundary."""

    status: Literal["running"] = "running"


class StartingState(StateValue):
    """An accepted operation whose driver has not started."""

    at: Literal["starting"] = "starting"
    control: RunningControl = Field(default_factory=RunningControl)
    settings: OperationSettings = Field(default_factory=OperationSettings)
    latest_assistant_entry_id: str | None = None


type OperationState = StartingState
