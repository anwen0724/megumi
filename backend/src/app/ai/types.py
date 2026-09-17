"""Defines the provider-neutral contracts shared by every part of the AI layer.

This module is types only: it performs no I/O, resolves no credentials and parses no
protocol. Callers construct these values, the protocol adapters translate them to a
vendor's wire format, and the stream container carries the results back.

Conventions:

- Field names keep the contract's spelling (``contentIndex``, ``toolCallId``) rather
  than Python's snake case, so serialized payloads need no name mapping.
- Closed sets of string values are ``StrEnum``, so they compare and serialize as plain
  strings while still being discoverable in code.
- Aliases use the ``type`` statement, whose value expression is evaluated lazily. That
  lets an alias name a class declared further down the module.
- Classes are declared before the alias block at the end of the file so that aliases can
  reference every class without forward-reference quoting.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Literal, Protocol

from app.ai.utils.abort import AbortSignal
from app.telemetry import TelemetryContext

if TYPE_CHECKING:
    # The stream container reads this module's event types, so it can only be named here.
    # Every annotation in this module is lazy, so nothing needs it while it loads.
    from app.ai.utils.event_stream import AssistantMessageEventStream

__all__ = [
    "API_OPTION_TYPES",
    "AllOpenAIOptions",
    "AnthropicAllowedFallbackModel",
    "AnthropicMessagesCompat",
    "AnthropicOptions",
    "Api",
    "ApiOptionsMap",
    "ApiStreamOptions",
    "AssistantContent",
    "AssistantImages",
    "AssistantMessage",
    "AssistantMessageDiagnostic",
    "AssistantMessageEvent",
    "AssistantMessageEventStream",
    "AzureOpenAIResponsesOptions",
    "BedrockCompat",
    "BedrockOptions",
    "CacheRetention",
    "ChatTemplateKwargValue",
    "ConstrainedSamplingConfig",
    "Context",
    "DeferredCancelOptions",
    "DeferredFetchOptions",
    "DeferredHandle",
    "DiagnosticErrorInfo",
    "EventDone",
    "EventError",
    "EventStart",
    "EventTextDelta",
    "EventTextEnd",
    "EventTextStart",
    "EventThinkingDelta",
    "EventThinkingEnd",
    "EventThinkingStart",
    "EventToolCallDelta",
    "EventToolCallEnd",
    "EventToolCallStart",
    "FetchFunction",
    "GoogleOptions",
    "GoogleVertexOptions",
    "GrammarFormat",
    "GrammarSampling",
    "GrammarVariants",
    "ImageContent",
    "ImagesApi",
    "ImagesContext",
    "ImagesFunction",
    "ImagesInputContent",
    "ImagesModel",
    "ImagesOptions",
    "ImagesOutputContent",
    "ImagesProviderId",
    "ImagesStopReason",
    "JsonSchemaSampling",
    "JsonValue",
    "KnownApi",
    "KnownImagesApi",
    "KnownImagesProvider",
    "KnownProvider",
    "Message",
    "MistralConversationsCompat",
    "MistralOptions",
    "Model",
    "ModelApiOptions",
    "ModelCompat",
    "ModelCost",
    "ModelCostRates",
    "ModelCostTier",
    "ModelThinkingLevel",
    "OpenAICodexResponsesOptions",
    "OpenAICompletionsCompat",
    "OpenAICompletionsOptions",
    "OpenAIResponsesCompat",
    "OpenAIResponsesOptions",
    "OpenRouterMaxPrice",
    "OpenRouterPercentileCutoffs",
    "OpenRouterRouting",
    "OpenRouterRoutingSort",
    "PiMessagesOptions",
    "ProviderEnv",
    "ProviderHeaders",
    "ProviderId",
    "ProviderImages",
    "ProviderImagesOptions",
    "ProviderRequestOptions",
    "ProviderResponse",
    "ProviderStreams",
    "SessionAffinityFormat",
    "SimpleStreamOptions",
    "StopReason",
    "StreamFunction",
    "StreamOptions",
    "SystemMessage",
    "TextContent",
    "TextSignatureV1",
    "ThinkingBudgets",
    "ThinkingContent",
    "ThinkingFormat",
    "ThinkingLevel",
    "ThinkingLevelMap",
    "ThinkingTokenBudgetField",
    "Tool",
    "ToolCall",
    "ToolChoice",
    "ToolReference",
    "ToolResultMessage",
    "TranscriptContext",
    "Transport",
    "Usage",
    "UsageCost",
    "UserMessage",
    "VercelGatewayRouting",
]

# ---------------------------------------------------------------------------
# Enumerated string values
# ---------------------------------------------------------------------------


class ToolChoice(StrEnum):
    """Provider-neutral tool selection for simple requests."""

    AUTO = "auto"
    NONE = "none"


class ThinkingLevel(StrEnum):
    """Reasoning effort a caller asks for.

    ``XHIGH`` and ``MAX`` are only supported by selected model families.
    """

    MINIMAL = "minimal"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    XHIGH = "xhigh"
    MAX = "max"


class ModelThinkingLevel(StrEnum):
    """A thinking level as a model catalog describes it, where ``off`` is an option."""

    OFF = "off"
    MINIMAL = "minimal"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    XHIGH = "xhigh"
    MAX = "max"


class ThinkingTokenBudgetField(StrEnum):
    """Top-level request field used to cap reasoning tokens on compatible servers."""

    THINKING_TOKEN_BUDGET = "thinking_token_budget"
    THINKING_BUDGET = "thinking_budget"
    THINKING_BUDGET_TOKENS = "thinking_budget_tokens"


class CacheRetention(StrEnum):
    """Prompt cache retention a caller prefers.

    Providers map this to the values they support; the adapters default to ``SHORT``.
    """

    NONE = "none"
    SHORT = "short"
    LONG = "long"


class Transport(StrEnum):
    """Preferred transport for providers that support more than one.

    Providers that do not support this option ignore it.
    """

    SSE = "sse"
    WEBSOCKET = "websocket"
    WEBSOCKET_CACHED = "websocket-cached"
    AUTO = "auto"


class SessionAffinityFormat(StrEnum):
    """Which session-affinity headers a provider sends."""

    OPENAI = "openai"
    OPENAI_NOSESSION = "openai-nosession"
    OPENROUTER = "openrouter"


class StopReason(StrEnum):
    """Why a response stopped.

    ``PENDING`` only ever appears on a message that is still being built; a terminating
    event carries one of the other reasons.
    """

    PENDING = "pending"
    STOP = "stop"
    LENGTH = "length"
    TOOL_USE = "toolUse"
    ERROR = "error"
    ABORTED = "aborted"
    DEFERRED = "deferred"


class GrammarFormat(StrEnum):
    """Grammar encodings a caller may supply for the same intended language."""

    OPENAI_LARK = "openai_lark"
    OPENAI_REGEX = "openai_regex"


class ThinkingFormat(StrEnum):
    """Wire convention used to express reasoning effort to an OpenAI-compatible server."""

    OPENAI = "openai"
    OPENROUTER = "openrouter"
    DEEPSEEK = "deepseek"
    TOGETHER = "together"
    BASETEN = "baseten"
    ZAI = "zai"
    QWEN = "qwen"
    CHAT_TEMPLATE = "chat-template"
    QWEN_CHAT_TEMPLATE = "qwen-chat-template"
    STRING_THINKING = "string-thinking"
    ANT_LING = "ant-ling"


class MessageRole(StrEnum):
    """The role a message plays in a transcript."""

    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL_RESULT = "toolResult"


class ContentType(StrEnum):
    """The kind of block a message or a stream delta carries."""

    TEXT = "text"
    THINKING = "thinking"
    IMAGE = "image"
    TOOL_CALL = "toolCall"


# ---------------------------------------------------------------------------
# Small value objects
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class ThinkingBudgets:
    """Per-level token budgets for token-based providers."""

    minimal: int | None = None
    low: int | None = None
    medium: int | None = None
    high: int | None = None


@dataclass(slots=True)
class ChatTemplateVar:
    """Reference to a thinking value to substitute into a chat template.

    The adapter replaces this object with the concrete thinking value before sending, and
    omits the key entirely when ``omitWhenOff`` is set and thinking is off.
    """

    var: Literal["thinking.enabled", "thinking.effort", "thinking.budget"]
    omitWhenOff: bool | None = None


@dataclass(slots=True)
class ProviderResponse:
    """The status and headers of an HTTP response, captured before its body is read."""

    status: int
    headers: dict[str, str]


@dataclass(slots=True)
class DeferredWindow:
    """The retention window requested together with a deferred response."""

    window: Literal["15m", "1h", "24h"] | None = None


@dataclass(slots=True)
class JsonSchemaSampling:
    """Constrain a tool call to a JSON schema, the "strict" concept in vendor APIs."""

    strict: Literal["prefer", "require"] = "prefer"
    type: Literal["json_schema"] = "json_schema"


@dataclass(slots=True)
class GrammarSampling:
    """Constrain a tool call to a grammar, with provider-specific encodings of it."""

    variants: GrammarVariants = field(default_factory=dict)
    type: Literal["grammar"] = "grammar"


@dataclass(slots=True)
class ToolReference:
    """A tool named for removal from the available set."""

    name: str


@dataclass(slots=True)
class Tool:
    """A callable the model may invoke.

    ``constrainedSampling`` is either ``False`` for "not constrained", a schema, or a
    grammar; leaving it unset lets the adapter decide.
    """

    name: str
    description: str
    parameters: dict[str, Any]
    constrainedSampling: bool | ConstrainedSamplingConfig | None = None


@dataclass(slots=True)
class TextSignatureV1:
    """Structured form of the provider metadata carried by a text block."""

    v: Literal[1]
    id: str
    phase: Literal["commentary", "final_answer"] | None = None


@dataclass(slots=True)
class TextContent:
    """A run of assistant or user text."""

    text: str
    type: Literal["text"] = "text"
    textSignature: str | None = None


@dataclass(slots=True)
class ThinkingContent:
    """A run of reasoning, possibly redacted by safety filters.

    When ``redacted`` is set, the opaque encrypted payload is kept in ``thinkingSignature``
    so it can be replayed to the provider for multi-turn continuity.
    """

    thinking: str
    type: Literal["thinking"] = "thinking"
    thinkingSignature: str | None = None
    redacted: bool | None = None


@dataclass(slots=True)
class ImageContent:
    """An inline image, base64 encoded."""

    data: str
    mimeType: str
    type: Literal["image"] = "image"


@dataclass(slots=True)
class ToolCall:
    """A tool call the model asked for."""

    id: str
    name: str
    arguments: dict[str, Any]
    type: Literal["toolCall"] = "toolCall"
    thoughtSignature: str | None = None
    namespace: str | None = None


@dataclass(slots=True)
class UsageCost:
    """What one request cost, in USD, broken down by token class."""

    input: float
    output: float
    cacheRead: float
    cacheWrite: float
    total: float


@dataclass(slots=True)
class Usage:
    """Token accounting for one request.

    ``output`` already includes any reasoning tokens, so ``reasoning`` is a subset rather
    than an additional count. ``reasoning`` stays ``None`` on providers that report no
    reasoning breakdown.
    """

    input: int
    output: int
    cacheRead: int
    cacheWrite: int
    totalTokens: int
    cost: UsageCost
    cacheWrite1h: int | None = None
    reasoning: int | None = None


@dataclass(slots=True)
class DeferredHandle:
    """A provider token that lets a deferred response be polled and reconstructed."""

    provider: str
    modelId: str
    api: str
    id: str
    expiresAt: int | None = None
    pollAfterMs: int | None = None
    data: JsonValue | None = None


@dataclass(slots=True)
class DiagnosticErrorInfo:
    """The parts of a failure worth keeping after it has been redacted."""

    message: str
    name: str | None = None
    stack: str | None = None
    code: str | int | None = None


@dataclass(slots=True)
class AssistantMessageDiagnostic:
    """A redacted provider or runtime diagnostic attached to an assistant message."""

    type: str
    timestamp: int
    error: DiagnosticErrorInfo | None = None
    details: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Transcript
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class SystemMessage:
    """System instructions and tool declarations at one point in the transcript.

    The leading system message is the system prompt. Later system messages change it:
    ``content`` adds instructions from that point on, ``sections`` replace or remove named
    prompt sections, and ``toolsAdded``/``toolsRemoved`` change the tool set. Replaying
    every system message in order yields the current prompt and tools. A message with
    ``replace`` discards the replayed state first, so it is a complete new baseline.

    Providers that accept system messages mid-conversation send each one in place; other
    providers, and every provider after a replacement, rebuild the leading system message
    from the replayed state.
    """

    content: str | list[TextContent]
    timestamp: int
    role: Literal["system"] = "system"
    sections: dict[str, str | None] | None = None
    toolsAdded: list[Tool] | None = None
    toolsRemoved: list[ToolReference] | None = None
    replace: bool | None = None


@dataclass(slots=True)
class UserMessage:
    """A user turn."""

    content: str | list[TextContent | ImageContent]
    timestamp: int
    role: Literal["user"] = "user"


@dataclass(slots=True)
class AssistantMessage:
    """An assistant turn, complete or still being streamed.

    ``responseModel`` and ``responseId`` report what the provider actually served, which
    can differ from what was requested. ``rawStopReason`` keeps the provider's own stop
    string when the mapped :class:`StopReason` loses detail.
    """

    content: list[TextContent | ThinkingContent | ToolCall]
    api: str
    provider: str
    model: str
    usage: Usage
    stopReason: StopReason
    timestamp: int
    role: Literal["assistant"] = "assistant"
    responseModel: str | None = None
    responseId: str | None = None
    providerThinkingLevel: str | None = None
    diagnostics: list[AssistantMessageDiagnostic] | None = None
    deferred: DeferredHandle | None = None
    errorMessage: str | None = None
    rawStopReason: str | None = None
    endTurn: bool | None = None


@dataclass(slots=True)
class ToolResultMessage:
    """The outcome of a tool call, fed back to the model.

    ``usage`` describes the tool's own execution and is not part of the model's context
    accounting.
    """

    toolCallId: str
    toolName: str
    content: list[TextContent | ImageContent]
    isError: bool
    timestamp: int
    role: Literal["toolResult"] = "toolResult"
    details: Any = None
    usage: Usage | None = None


@dataclass(slots=True)
class Context:
    """Request input accepted by the public stream entry points.

    ``systemPrompt`` and ``tools`` are shorthand for a leading system message;
    ``normalizeContext`` folds them into one before the request reaches a provider.
    """

    messages: list[Message]
    systemPrompt: str | None = None
    tools: list[Tool] | None = None


@dataclass(slots=True)
class TranscriptContext:
    """Normalized request context passed to providers and API implementations.

    The prompt and tool declarations are carried by the transcript's system messages.
    Only ``normalizeContext`` produces this type, so a raw :class:`Context` cannot reach
    provider code by accident.
    """

    messages: list[Message]


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class ImagesContext:
    """Request input for an image-generation call."""

    input: list[ImagesInputContent]


@dataclass(slots=True)
class AssistantImages:
    """The result of an image-generation call."""

    api: str
    provider: str
    model: str
    output: list[ImagesOutputContent]
    stopReason: ImagesStopReason
    timestamp: int
    responseId: str | None = None
    usage: Usage | None = None
    errorMessage: str | None = None


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class OpenRouterRoutingSort:
    """Sorting strategy for OpenRouter provider selection."""

    by: str | None = None
    partition: str | None = None


@dataclass(slots=True)
class OpenRouterMaxPrice:
    """Maximum price per million tokens, or per image, audio unit and request."""

    prompt: float | str | None = None
    completion: float | str | None = None
    image: float | str | None = None
    audio: float | str | None = None
    request: float | str | None = None


@dataclass(slots=True)
class OpenRouterPercentileCutoffs:
    """A throughput or latency bound stated per percentile."""

    p50: float | None = None
    p75: float | None = None
    p90: float | None = None
    p99: float | None = None


@dataclass(slots=True)
class OpenRouterRouting:
    """OpenRouter provider routing preferences, sent as the ``provider`` request field."""

    allow_fallbacks: bool | None = None
    require_parameters: bool | None = None
    data_collection: Literal["deny", "allow"] | None = None
    zdr: bool | None = None
    enforce_distillable_text: bool | None = None
    order: list[str] | None = None
    only: list[str] | None = None
    ignore: list[str] | None = None
    quantizations: list[str] | None = None
    sort: str | OpenRouterRoutingSort | None = None
    max_price: OpenRouterMaxPrice | None = None
    preferred_min_throughput: float | OpenRouterPercentileCutoffs | None = None
    preferred_max_latency: float | OpenRouterPercentileCutoffs | None = None


@dataclass(slots=True)
class VercelGatewayRouting:
    """Vercel AI Gateway provider routing preferences."""

    only: list[str] | None = None
    order: list[str] | None = None


@dataclass(slots=True)
class OpenAICompletionsCompat:
    """Compatibility overrides for OpenAI-compatible completions APIs.

    Every field is ``None`` when unset, which lets the adapter fall back to detecting the
    answer from the base URL.
    """

    supportsStore: bool | None = None
    supportsDeveloperRole: bool | None = None
    supportsReasoningEffort: bool | None = None
    supportsUsageInStreaming: bool | None = None
    supportsFinishReason: bool | None = None
    maxTokensField: Literal["max_completion_tokens", "max_tokens"] | None = None
    requiresToolResultName: bool | None = None
    requiresAssistantAfterToolResult: bool | None = None
    requiresThinkingAsText: bool | None = None
    requiresReasoningContentOnAssistantMessages: bool | None = None
    thinkingFormat: ThinkingFormat | None = None
    chatTemplateKwargs: dict[str, ChatTemplateKwargValue] | None = None
    chatTemplateArgs: dict[str, ChatTemplateKwargValue] | None = None
    openRouterRouting: OpenRouterRouting | None = None
    vercelGatewayRouting: VercelGatewayRouting | None = None
    zaiToolStream: bool | None = None
    thinkingTokenBudgetField: ThinkingTokenBudgetField | None = None
    supportsThinkingTokenBudget: bool | None = None
    supportsOpenAIGrammarTools: bool | None = None
    supportsMidConvoSystemMessages: bool | None = None
    supportsMidConvoToolAdditions: bool | None = None
    supportsStrictMode: bool | None = None
    cacheControlFormat: Literal["anthropic"] | None = None
    sendSessionAffinityHeaders: bool | None = None
    sessionAffinityFormat: SessionAffinityFormat | None = None
    supportsLongCacheRetention: bool | None = None
    vllmPriority: int | None = None


@dataclass(slots=True)
class OpenAIResponsesCompat:
    """Compatibility overrides for OpenAI Responses APIs."""

    supportsDeveloperRole: bool | None = None
    supportsMidConvoSystemMessages: bool | None = None
    sessionAffinityFormat: SessionAffinityFormat | None = None
    supportsLongCacheRetention: bool | None = None
    supportsStrictMode: bool | None = None
    supportsOpenAIGrammarTools: bool | None = None
    supportsAdditionalTools: bool | None = None
    supportsToolSearch: bool | None = None
    supportsExplicitPromptCacheMode: bool | None = None
    supportsMaxOutputTokens: bool | None = None


@dataclass(slots=True)
class AnthropicAllowedFallbackModel:
    """A model Anthropic may fall back to on a refusal, with its local pricing metadata."""

    provider: str
    model: str
    cost: ModelCost


@dataclass(slots=True)
class AnthropicMessagesCompat:
    """Compatibility overrides for Anthropic Messages-compatible APIs."""

    supportsEagerToolInputStreaming: bool | None = None
    supportsLongCacheRetention: bool | None = None
    sendSessionAffinityHeaders: bool | None = None
    sessionAffinityFormat: Literal["openrouter"] | None = None
    supportsCacheControlOnTools: bool | None = None
    supportsTemperature: bool | None = None
    forceAdaptiveThinking: bool | None = None
    allowEmptySignature: bool | None = None
    supportsStrictTools: bool | None = None
    supportsMidConvoEffort: bool | None = None
    supportsMidConvoSystemMessages: bool | None = None
    supportsMidConvoToolChanges: bool | None = None
    allowedFallbackModels: list[AnthropicAllowedFallbackModel] | None = None


@dataclass(slots=True)
class BedrockCompat:
    """Compatibility overrides for Amazon Bedrock models."""

    supportsStrictMode: bool | None = None


@dataclass(slots=True)
class MistralConversationsCompat:
    """Compatibility overrides for the Mistral conversations API."""

    supportsMidConvoSystemMessages: bool | None = None


@dataclass(slots=True)
class ModelCostRates:
    """Cost in USD per million tokens, by token class."""

    input: float
    output: float
    cacheRead: float
    cacheWrite: float


@dataclass(slots=True)
class ModelCostTier(ModelCostRates):
    """A price tier used for requests whose total input usage exceeds a threshold."""

    inputTokensAbove: int


@dataclass(slots=True)
class ModelCost(ModelCostRates):
    """A model's pricing.

    The highest matching tier threshold applies to the whole request, not to the tokens
    above it.
    """

    tiers: list[ModelCostTier] | None = None


@dataclass(slots=True)
class Model:
    """A model the layer can send requests to.

    ``compat`` carries per-API compatibility overrides. A model whose API has no
    compatibility surface leaves it unset, and an adapter auto-detects from ``baseUrl``
    when the caller does.
    """

    id: str
    name: str
    api: str
    provider: str
    baseUrl: str
    reasoning: bool
    input: list[Literal["text", "image"]]
    cost: ModelCost
    contextWindow: int
    maxTokens: int
    thinkingLevelMap: ThinkingLevelMap | None = None
    samplingParams: dict[str, Any] | None = None
    headers: dict[str, str] | None = None
    compat: ModelCompat | None = None


@dataclass(slots=True)
class ImagesModel:
    """An image-generation model: a :class:`Model` with an image output contract."""

    id: str
    name: str
    api: str
    provider: str
    baseUrl: str
    input: list[Literal["text", "image"]]
    output: list[Literal["text", "image"]]
    cost: ModelCost
    thinkingLevelMap: ThinkingLevelMap | None = None
    samplingParams: dict[str, Any] | None = None
    headers: dict[str, str] | None = None


# ---------------------------------------------------------------------------
# Request options
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class ProviderRequestOptions[TModel]:
    """Authentication, HTTP transport and lifecycle callbacks shared by provider requests.

    ``onPayload`` may replace the outgoing body; returning ``None`` keeps it unchanged.
    """

    signal: AbortSignal | None = None
    telemetryContext: TelemetryContext | None = None
    apiKey: str | None = None
    fetch: FetchFunction | None = None
    env: ProviderEnv | None = None
    onPayload: Callable[[Any, TModel], Any | Awaitable[Any]] | None = None
    onResponse: Callable[[ProviderResponse, TModel], Awaitable[None] | None] | None = None
    headers: ProviderHeaders | None = None
    timeoutMs: int | None = None
    maxRetries: int | None = None
    maxRetryDelayMs: int | None = None


@dataclass(slots=True)
class StreamOptions(ProviderRequestOptions[Model]):
    """Options common to every streaming request.

    ``samplingParams`` is merged into the request body after the named fields, so its keys
    win, and over the model's own defaults per key. Only OpenAI-compatible adapters apply
    it; other APIs ignore it.
    """

    temperature: float | None = None
    samplingParams: dict[str, Any] | None = None
    maxTokens: int | None = None
    transport: Transport | None = None
    cacheRetention: CacheRetention | None = None
    sessionId: str | None = None
    websocketConnectTimeoutMs: int | None = None
    metadata: dict[str, Any] | None = None


@dataclass(slots=True)
class SimpleStreamOptions(StreamOptions):
    """Unified options with reasoning, passed to the simple entry points."""

    toolChoice: ToolChoice | None = None
    reasoning: ThinkingLevel | None = None
    deferred: bool | DeferredWindow | None = None
    thinkingBudgets: ThinkingBudgets | None = None


@dataclass(slots=True)
class DeferredFetchOptions(ProviderRequestOptions[Model]):
    """Options for polling a deferred response.

    ``wait`` is the provider long-poll duration; ``None`` performs one status check.
    """

    wait: int | None = None


@dataclass(slots=True)
class ImagesOptions(ProviderRequestOptions[ImagesModel]):
    """Options common to image-generation requests."""

    metadata: dict[str, Any] | None = None


@dataclass(slots=True)
class OpenAICompletionsOptions(StreamOptions):
    """Stream options with the fields the OpenAI-compatible completions API accepts."""

    parallelToolCalls: bool | None = None


@dataclass(slots=True)
class OpenAIResponsesOptions(StreamOptions):
    """Stream options with the fields the OpenAI Responses API accepts."""

    parallelToolCalls: bool | None = None


@dataclass(slots=True)
class AzureOpenAIResponsesOptions(OpenAIResponsesOptions):
    """Stream options for the Azure OpenAI Responses deployment."""


@dataclass(slots=True)
class OpenAICodexResponsesOptions(OpenAIResponsesOptions):
    """Stream options for the OpenAI Codex responses protocol."""


@dataclass(slots=True)
class AnthropicOptions(StreamOptions):
    """Stream options with the fields the Anthropic Messages API accepts."""

    thinkingDisplay: Literal["summarized", "omitted"] | None = None


@dataclass(slots=True)
class BedrockOptions(StreamOptions):
    """Stream options with the fields the Bedrock Converse API accepts."""

    region: str | None = None


@dataclass(slots=True)
class GoogleOptions(StreamOptions):
    """Stream options with the fields the Google Generative AI API accepts."""

    safetySettings: list[dict[str, Any]] | None = None


@dataclass(slots=True)
class GoogleVertexOptions(GoogleOptions):
    """Stream options for Google Vertex AI, which adds project placement."""

    project: str | None = None
    location: str | None = None


@dataclass(slots=True)
class MistralOptions(StreamOptions):
    """Stream options with the fields the Mistral conversations API accepts."""

    safePrompt: bool | None = None


@dataclass(slots=True)
class PiMessagesOptions(StreamOptions):
    """Stream options with the fields the native messages API accepts."""

    extraBody: dict[str, Any] | None = None


@dataclass(slots=True)
class ProviderStreams:
    """The uniform stream contract of an API implementation module.

    Every API module provides ``stream`` and ``streamSimple``; a module that can defer a
    response also provides the two deferred methods.
    """

    stream: StreamFunction
    streamSimple: StreamFunction
    fetchDeferred: (
        Callable[[Model, DeferredHandle, DeferredFetchOptions | None], AssistantMessageEventStream]
        | None
    ) = None
    cancelDeferred: (
        Callable[[Model, DeferredHandle, DeferredCancelOptions | None], Awaitable[None]] | None
    ) = None


@dataclass(slots=True)
class ProviderImages:
    """The uniform contract of an image-generation API implementation module."""

    generateImages: ImagesFunction


# ---------------------------------------------------------------------------
# Stream events
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class EventStart:
    """The stream has begun; the message is present but empty."""

    partial: AssistantMessage
    type: Literal["start"] = "start"


@dataclass(slots=True)
class EventTextStart:
    """A text block has opened at ``contentIndex``; its content is still empty."""

    contentIndex: int
    partial: AssistantMessage
    type: Literal["text_start"] = "text_start"


@dataclass(slots=True)
class EventTextDelta:
    """More text arrived for the open block."""

    contentIndex: int
    delta: str
    partial: AssistantMessage
    type: Literal["text_delta"] = "text_delta"


@dataclass(slots=True)
class EventTextEnd:
    """The text block at ``contentIndex`` is complete and authoritative."""

    contentIndex: int
    content: str
    partial: AssistantMessage
    type: Literal["text_end"] = "text_end"


@dataclass(slots=True)
class EventThinkingStart:
    """A thinking block has opened at ``contentIndex``.

    A redacted block may already be complete here and emit no deltas.
    """

    contentIndex: int
    partial: AssistantMessage
    type: Literal["thinking_start"] = "thinking_start"


@dataclass(slots=True)
class EventThinkingDelta:
    """More reasoning arrived for the open block."""

    contentIndex: int
    delta: str
    partial: AssistantMessage
    type: Literal["thinking_delta"] = "thinking_delta"


@dataclass(slots=True)
class EventThinkingEnd:
    """The thinking block at ``contentIndex`` is complete and authoritative."""

    contentIndex: int
    content: str
    partial: AssistantMessage
    type: Literal["thinking_end"] = "thinking_end"


@dataclass(slots=True)
class EventToolCallStart:
    """A tool call has opened at ``contentIndex``.

    Its arguments are whatever the provider reported at this point, which is
    provider-specific and not necessarily valid JSON.
    """

    contentIndex: int
    partial: AssistantMessage
    type: Literal["toolcall_start"] = "toolcall_start"


@dataclass(slots=True)
class EventToolCallDelta:
    """More JSON for the open tool call's arguments."""

    contentIndex: int
    delta: str
    partial: AssistantMessage
    type: Literal["toolcall_delta"] = "toolcall_delta"


@dataclass(slots=True)
class EventToolCallEnd:
    """The tool call at ``contentIndex`` is complete."""

    contentIndex: int
    toolCall: ToolCall
    partial: AssistantMessage
    type: Literal["toolcall_end"] = "toolcall_end"


@dataclass(slots=True)
class EventDone:
    """The stream finished successfully."""

    reason: Literal["stop", "length", "toolUse", "deferred"]
    message: AssistantMessage
    type: Literal["done"] = "done"


@dataclass(slots=True)
class EventError:
    """The stream terminated unsuccessfully.

    Request setup failures can terminate the stream before any ``start`` event.
    """

    reason: Literal["aborted", "error"]
    error: AssistantMessage
    type: Literal["error"] = "error"


# ---------------------------------------------------------------------------
# Aliases
# ---------------------------------------------------------------------------

type KnownApi = Literal[
    "openai-completions",
    "mistral-conversations",
    "openai-responses",
    "azure-openai-responses",
    "openai-codex-responses",
    "anthropic-messages",
    "bedrock-converse-stream",
    "google-generative-ai",
    "google-vertex",
    "pi-messages",
]

# An API name the layer does not know is still accepted; it is dispatched by registration.
type Api = KnownApi | str

type KnownImagesApi = Literal["openrouter-images"]

type ImagesApi = KnownImagesApi | str

type KnownProvider = Literal[
    "amazon-bedrock",
    "ant-ling",
    "anthropic",
    "google",
    "google-vertex",
    "openai",
    "azure-openai-responses",
    "openai-codex",
    "radius",
    "nvidia",
    "deepseek",
    "github-copilot",
    "xai",
    "groq",
    "cerebras",
    "openrouter",
    "vercel-ai-gateway",
    "zai",
    "zai-coding-cn",
    "mistral",
    "minimax",
    "minimax-cn",
    "moonshotai",
    "moonshotai-cn",
    "huggingface",
    "fireworks",
    "together",
    "baseten",
    "opencode",
    "opencode-go",
    "kimi-coding",
    "cloudflare-workers-ai",
    "cloudflare-ai-gateway",
    "qwen-token-plan",
    "qwen-token-plan-cn",
    "qwen-token-plan-individual",
    "xiaomi",
    "xiaomi-token-plan-cn",
    "xiaomi-token-plan-ams",
    "xiaomi-token-plan-sgp",
]

type ProviderId = KnownProvider | str

type KnownImagesProvider = Literal["openrouter"]

type ImagesProviderId = KnownImagesProvider | str

type ThinkingLevelMap = dict[ModelThinkingLevel, str | None]

type ChatTemplateKwargValue = str | float | bool | ChatTemplateVar | None

type JsonValue = bool | int | float | str | list[JsonValue] | dict[str, JsonValue] | None

type ProviderEnv = dict[str, str]

type ProviderHeaders = dict[str, str | None]

type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage

type ModelCompat = (
    OpenAICompletionsCompat
    | OpenAIResponsesCompat
    | AnthropicMessagesCompat
    | BedrockCompat
    | MistralConversationsCompat
)

type ModelApiOptions = (
    AnthropicOptions
    | OpenAICompletionsOptions
    | OpenAIResponsesOptions
    | OpenAICodexResponsesOptions
    | AzureOpenAIResponsesOptions
    | GoogleOptions
    | GoogleVertexOptions
    | MistralOptions
    | BedrockOptions
    | PiMessagesOptions
)

class ApiOptionsMap(Protocol):
    """Resolves a known API name to the option type its adapter accepts.

    The reference states this as a type-level lookup table. Python has no such table, so
    the same mapping is stated here as a dependent signature: the API name determines the
    returned option type. :data:`API_OPTION_TYPES` carries the runtime counterpart for
    code that needs to look a class up by name.
    """

    def optionsFor(self, api: KnownApi) -> ModelApiOptions:
        """Return the options type paired with ``api``."""
        ...


API_OPTION_TYPES: dict[str, type[ModelApiOptions]] = {
    "anthropic-messages": AnthropicOptions,
    "openai-completions": OpenAICompletionsOptions,
    "openai-responses": OpenAIResponsesOptions,
    "openai-codex-responses": OpenAICodexResponsesOptions,
    "azure-openai-responses": AzureOpenAIResponsesOptions,
    "google-generative-ai": GoogleOptions,
    "google-vertex": GoogleVertexOptions,
    "mistral-conversations": MistralOptions,
    "bedrock-converse-stream": BedrockOptions,
    "pi-messages": PiMessagesOptions,
}

type ApiStreamOptions = ModelApiOptions | StreamOptions

type ProviderStreamOptions = StreamOptions

type DeferredCancelOptions = ProviderRequestOptions[Model]

type ProviderImagesOptions = ImagesOptions

type ImagesInputContent = TextContent | ImageContent

type ImagesOutputContent = TextContent | ImageContent

type ImagesStopReason = Literal["stop", "error", "aborted"]

type AssistantContent = TextContent | ThinkingContent | ToolCall

type GrammarVariants = dict[GrammarFormat, str]

type ConstrainedSamplingConfig = JsonSchemaSampling | GrammarSampling

type AllOpenAIOptions = OpenAICompletionsOptions | OpenAIResponsesOptions

type AssistantMessageEvent = (
    EventStart
    | EventTextStart
    | EventTextDelta
    | EventTextEnd
    | EventThinkingStart
    | EventThinkingDelta
    | EventThinkingEnd
    | EventToolCallStart
    | EventToolCallDelta
    | EventToolCallEnd
    | EventDone
    | EventError
)

type StreamFunction = Callable[
    [Model, TranscriptContext, StreamOptions | None],
    AssistantMessageEventStream,
]

type ImagesFunction = Callable[
    [ImagesModel, ImagesContext, ImagesOptions | None],
    Awaitable[AssistantImages],
]


class FetchFunction(Protocol):
    """The HTTP fetch contract an adapter may be handed instead of the global one."""

    def __call__(self, url: str, init: dict[str, Any] | None = None) -> Awaitable[Any]:
        """Perform one HTTP request."""
        ...
