"""Transport-independent message records; active assistant content is mutable."""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import ConfigDict, Field

type JSONValue = bool | int | float | str | list[JSONValue] | dict[str, JSONValue] | None
type StopReason = Literal["pending", "stop", "length", "tool_use", "error", "aborted"]


class _Record:
    """Reject unknown saved fields without imposing validation at construction."""

    __pydantic_config__ = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


@dataclass(kw_only=True)
class TextContent(_Record):
    """Visible text, optionally carrying a protocol replay signature."""

    text: str
    text_signature: str | None = None
    type: Literal["text"] = "text"


@dataclass(kw_only=True)
class ImageContent(_Record):
    """Inline image data; URL fetching is outside the message contract."""

    mime_type: str
    data: str
    type: Literal["image"] = "image"


@dataclass(kw_only=True)
class ThinkingContent(_Record):
    """Visible or signed/redacted reasoning preserved for compatible replay."""

    thinking: str
    thinking_signature: str | None = None
    redacted: bool | None = None
    type: Literal["thinking"] = "thinking"


@dataclass(kw_only=True)
class ToolCall(_Record):
    """Generated JSON is unvalidated until explicit tool argument validation."""

    id: str
    name: str
    arguments: JSONValue
    thought_signature: str | None = None
    namespace: str | None = None
    type: Literal["toolCall"] = "toolCall"


@dataclass(kw_only=True)
class JsonSchemaSampling(_Record):
    """Optional provider-side JSON Schema enforcement policy."""

    strict: Literal["prefer", "require"]
    type: Literal["json_schema"] = "json_schema"


@dataclass(kw_only=True)
class Tool(_Record):
    """Serializable tool declaration, without execution or presentation callbacks."""

    name: str
    description: str
    parameters: dict[str, JSONValue]
    constrained_sampling: JsonSchemaSampling | Literal[False] | None = None


type InputContent = Annotated[TextContent | ImageContent, Field(discriminator="type")]
type AssistantContent = Annotated[
    TextContent | ThinkingContent | ToolCall, Field(discriminator="type")
]


@dataclass(kw_only=True)
class SystemMessage(_Record):
    """An ordered instruction and tool declaration change."""

    content: str | list[TextContent]
    timestamp: int
    sections: dict[str, str | None] | None = None
    tools_added: list[Tool] | None = None
    tools_removed: list[str] | None = None
    replace: bool = False
    role: Literal["system"] = "system"


@dataclass(kw_only=True)
class UserMessage(_Record):
    """User input and its original timestamp."""

    content: str | list[InputContent]
    timestamp: int
    role: Literal["user"] = "user"


@dataclass(kw_only=True)
class UsageCost(_Record):
    """Exact monetary amounts; unknown components and total stay None."""

    currency: str = "USD"
    input: Decimal | None = None
    output: Decimal | None = None
    cache_read: Decimal | None = None
    cache_write: Decimal | None = None
    total: Decimal | None = None


@dataclass(kw_only=True)
class Usage(_Record):
    """Reported counts, with reasoning a subset of output, not an added charge."""

    input: int | None = None
    output: int | None = None
    cache_read: int | None = None
    cache_write: int | None = None
    reasoning: int | None = None
    total_tokens: int | None = None
    cost: UsageCost | None = None


@dataclass(kw_only=True)
class DiagnosticErrorInfo(_Record):
    """Serializable error evidence carried by a pi-style message diagnostic."""

    message: str
    name: str | None = None
    stack: str | None = None
    code: str | int | float | None = None


@dataclass(kw_only=True)
class AssistantMessageDiagnostic(_Record):
    """One ordered diagnostic, separate from generated content and stop reason."""

    type: str
    timestamp: int
    error: DiagnosticErrorInfo | None = None
    details: dict[str, JSONValue] | None = None


@dataclass(kw_only=True)
class AssistantMessage(_Record):
    """Provider-qualified generated content, including active partial state."""

    content: list[AssistantContent]
    provider: str
    api: str
    model: str
    timestamp: int
    usage: Usage = field(default_factory=Usage)
    stop_reason: StopReason = "pending"
    response_id: str | None = None
    response_model: str | None = None
    raw_stop_reason: str | None = None
    error_message: str | None = None
    diagnostics: list[AssistantMessageDiagnostic] | None = None
    provider_thinking_level: str | None = None
    end_turn: bool | None = None
    role: Literal["assistant"] = "assistant"


@dataclass(kw_only=True)
class ToolResultMessage(_Record):
    """Caller-provided tool result, including errors and optional display data."""

    tool_call_id: str
    tool_name: str
    content: list[InputContent]
    is_error: bool
    timestamp: int
    details: JSONValue = None
    usage: Usage | None = None
    role: Literal["toolResult"] = "toolResult"


type Message = Annotated[
    SystemMessage | UserMessage | AssistantMessage | ToolResultMessage, Field(discriminator="role")
]


@dataclass(kw_only=True)
class Context:
    """Caller shorthand; normalization moves prompt and tools into system messages."""

    messages: list[Message]
    system_prompt: str | None = None
    tools: list[Tool] | None = None


@dataclass(kw_only=True)
class Transcript:
    """Normalized input whose system records own prompt and tool state."""

    messages: list[Message]
