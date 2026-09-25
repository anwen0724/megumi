"""Represent validated durable Operation phases, without driving execution."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.ai import JSONValue
from app.ai.options import ReasoningLevel


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


class CommonState(StateValue):
    """Control and configuration shared by all durable phases."""

    control: RunningControl = Field(default_factory=RunningControl)
    settings: OperationSettings = Field(default_factory=OperationSettings)
    latest_assistant_entry_id: str | None = None


class StartingState(CommonState):
    """An accepted operation whose driver has not started."""

    at: Literal["starting"] = "starting"


class NeedAssistant(StateValue):
    """The next checkpoint must request an assistant."""

    kind: Literal["need_assistant"] = "need_assistant"
    overflow_recovery_used: bool = False


class MayFinish(StateValue):
    """The next checkpoint may finish with the recorded assistant."""

    kind: Literal["may_finish"] = "may_finish"
    include_final_assistant: bool = True


class CheckpointState(CommonState):
    """A saved decision boundary rather than a Python stack snapshot."""

    at: Literal["checkpoint"] = "checkpoint"
    continuation: Annotated[NeedAssistant | MayFinish, Field(discriminator="kind")]
    trigger_entry_id: str | None


class GenerationConfiguration(StateValue):
    """Serializable model and tool identities used by a request."""

    provider: str
    model_id: str
    thinking_level: ReasoningLevel = "off"
    active_tool_names: list[str] = Field(default_factory=list)


class SavedRetryPolicy(StateValue):
    """An explicitly chosen attempt policy, not a retry implementation."""

    max_attempts: int = Field(default=1, ge=1)
    base_delay_ms: float = Field(default=0, ge=0)
    max_agent_delay_ms: float = Field(default=60000, ge=0)


class GenerationContext(StateValue):
    """Materials identifying one logical generation step."""

    step_id: str
    trigger_entry_id: str | None
    configuration: GenerationConfiguration
    stream_options: dict[str, JSONValue] = Field(default_factory=dict)
    retry_policy: SavedRetryPolicy = Field(default_factory=SavedRetryPolicy)
    overflow_recovery_used: bool = False


class AssistantReadyState(CommonState):
    """A generation step before its next request intent is saved."""

    at: Literal["assistant.ready"] = "assistant.ready"
    generation_context: GenerationContext
    next_attempt: int = Field(ge=1)


class AssistantPendingState(CommonState):
    """A saved request intent whose external result is not yet committed."""

    at: Literal["assistant.effect_pending"] = "assistant.effect_pending"
    generation_context: GenerationContext
    attempt: int = Field(ge=1)
    response_entry_id: str
    usage_id: str
    intended_output_limit: int = Field(gt=0)
    context_window: int = Field(gt=0)


class ToolBatch(StateValue):
    """Identify the source message and configuration of an ordered tool batch."""

    assistant_entry_id: str
    configuration: GenerationConfiguration
    turn_id: str


class ToolsState(CommonState):
    """A batch whose individual child states live only in tool_executions."""

    at: Literal["tools"] = "tools"
    batch: ToolBatch


type OperationState = Annotated[
    StartingState | CheckpointState | AssistantReadyState | AssistantPendingState | ToolsState,
    Field(discriminator="at"),
]
