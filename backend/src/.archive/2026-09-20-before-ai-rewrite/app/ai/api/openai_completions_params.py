"""Request body construction for the OpenAI-compatible Chat Completions protocol.

Two jobs live here. :func:`convert_messages` turns the internal transcript into the protocol's
message array, including the per-provider quirks a server expects back (instruction role,
replayed reasoning, tool-call id shape, tool results). :func:`build_params` turns the model,
the compatibility flags and the caller's options into the request body itself, which is where
the different reasoning dialects of the compatible servers are translated into the field each
of them understands.

Wire-format names are kept exactly as the protocol spells them (``tool_calls``,
``prompt_cache_key``, ``max_completion_tokens``): the mappings built here are serialized into
the HTTP request body, so renaming a key would change the request.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import asdict, is_dataclass
from typing import NotRequired, TypedDict, TypeGuard, cast

from app.ai.api.constrained_sampling import (
    get_grammar_tool_input,
    get_json_schema_tool_parameters,
    resolve_grammar_constrained_sampling,
    resolve_json_schema_strict_sampling,
)
from app.ai.api.openai_prompt_cache import clamp_openai_prompt_cache_key
from app.ai.api.transform_messages import transform_messages
from app.ai.types import (
    AssistantMessage,
    CacheRetention,
    ChatTemplateKwargValue,
    ChatTemplateVar,
    ImageContent,
    JsonValue,
    Model,
    ModelThinkingLevel,
    OpenAICompletionsCompat,
    OpenAICompletionsOptions,
    ProviderEnv,
    SystemMessage,
    TextContent,
    ThinkingBudgets,
    ThinkingContent,
    ThinkingLevel,
    ThinkingTokenBudgetField,
    Tool,
    ToolCall,
    ToolResultMessage,
    TranscriptContext,
    UserMessage,
)
from app.ai.utils.hash import shortHash
from app.ai.utils.provider_env import getProviderEnvValue
from app.ai.utils.sanitize_unicode import sanitizeSurrogates
from app.ai.utils.text import getSystemMessageText, renderSystemMessageUpdate
from app.ai.utils.transcript import (
    get_declared_tools,
    resolve_transcript,
    resolve_transcript_tools,
)

__all__ = [
    "CacheControl",
    "ResolvedChatTemplateKwargValue",
    "addCacheControlToInstructionMessage",
    "addCacheControlToLastConversationMessage",
    "addCacheControlToLastTool",
    "addCacheControlToMessage",
    "addCacheControlToSystemPrompt",
    "addCacheControlToTextContent",
    "applyAnthropicCacheControl",
    "buildChatTemplateValues",
    "buildParams",
    "convertMessages",
    "convertTools",
    "getCompatCacheControl",
    "has_tool_history",
    "isImageContentBlock",
    "isOpenAIReasoningDetail",
    "isTextContentBlock",
    "isThinkingContentBlock",
    "isToolCallBlock",
    "resolveCacheRetention",
    "resolveChatTemplateKwargValue",
    "resolveClampedThinkingBudget",
    "resolveThinkingTokenBudgetField",
    "thinkingBudgetForLevel",
]

# ---------------------------------------------------------------------------
# Shapes written into the request body
# ---------------------------------------------------------------------------

# A resolved value for one chat-template keyword argument. The variable-reference form is gone
# by this point: it has been replaced by the concrete value it stands for.
type ResolvedChatTemplateKwargValue = str | int | float | bool | None

# The field names a thinking signature may name, in the order a caller checks them.
_REASONING_FIELDS = ("reasoning", "reasoning_content", "reasoning_text")

# Tokens left for the answer when a thinking budget shares one response ceiling.
_MIN_ANSWER_TOKENS = 1024
_DEFAULT_THINKING_BUDGETS: dict[ThinkingLevel, int] = {
    ThinkingLevel.MINIMAL: 1024,
    ThinkingLevel.LOW: 2048,
    ThinkingLevel.MEDIUM: 8192,
    ThinkingLevel.HIGH: 16384,
}

# Characters a server accepts in a request tool-call identifier.
_DISALLOWED_TOOL_CALL_ID_CHARS = re.compile(r"[^a-zA-Z0-9_-]")


class CacheControl(TypedDict):
    """The prompt-cache marker an Anthropic-compatible server accepts on one content part."""

    type: str
    ttl: NotRequired[str]


class ChatContentPartText(TypedDict):
    """One text part of a message whose content travels as an array of parts."""

    type: str
    text: str
    cache_control: NotRequired[CacheControl]


class ChatContentPartImage(TypedDict):
    """One inline image part, carried as a data URL."""

    type: str
    image_url: dict[str, str]
    cache_control: NotRequired[CacheControl]


class ChatMessageTool(TypedDict):
    """A tool result fed back to the model."""

    role: str
    content: str
    tool_call_id: str
    name: NotRequired[str]
    cache_control: NotRequired[CacheControl]


class ChatMessageUser(TypedDict):
    """A user turn, whose content is either plain text or a list of parts."""

    role: str
    content: str | list[ChatContentPartText | ChatContentPartImage]
    cache_control: NotRequired[CacheControl]


class ChatMessageAssistant(TypedDict):
    """An assistant turn, including the replay fields some servers insist on.

    The instruction roles and the tool-declaring system message reuse this key set, which is
    why every field beyond the role and the content is optional.
    """

    role: str
    content: str | list[ChatContentPartText | ChatContentPartImage] | None
    tool_calls: NotRequired[list[dict[str, object]]]
    reasoning_details: NotRequired[list[JsonValue]]
    reasoning: NotRequired[str]
    reasoning_content: NotRequired[str]
    reasoning_text: NotRequired[str]
    cache_control: NotRequired[CacheControl]


class ChatToolFunction(TypedDict):
    """The function declaration of a tool the model may call."""

    name: str
    description: str
    parameters: dict[str, object]
    strict: NotRequired[bool]


class ChatTool(TypedDict):
    """One entry of the request's ``tools`` array, in either of its two forms."""

    type: str
    function: NotRequired[ChatToolFunction]
    custom: NotRequired[dict[str, object]]
    cache_control: NotRequired[CacheControl]


# A content part the two message shapes above hold. Each concrete part class defines its own
# discriminant, so a union member is identified by the keys it carries rather than by a class.
type ChatContentPart = ChatContentPartText | ChatContentPartImage

# Any message this module builds.
type ChatMessage = ChatMessageUser | ChatMessageAssistant | ChatMessageTool


# ---------------------------------------------------------------------------
# Content-block predicates
# ---------------------------------------------------------------------------


def isTextContentBlock(block: object) -> TypeGuard[TextContent]:
    """Whether ``block`` is a run of text."""

    return isinstance(block, TextContent)


def isThinkingContentBlock(block: object) -> TypeGuard[ThinkingContent]:
    """Whether ``block`` is a run of reasoning."""

    return isinstance(block, ThinkingContent)


def isToolCallBlock(block: object) -> TypeGuard[ToolCall]:
    """Whether ``block`` is a tool call the model asked for."""

    return isinstance(block, ToolCall)


def isImageContentBlock(block: object) -> TypeGuard[ImageContent]:
    """Whether ``block`` is an inline image."""

    return isinstance(block, ImageContent)


def _text_blocks(blocks: Sequence[object]) -> list[TextContent]:
    """Filter ``blocks`` down to the text runs they contain."""

    return [block for block in blocks if isinstance(block, TextContent)]


def _thinking_blocks(blocks: Sequence[object]) -> list[ThinkingContent]:
    """Filter ``blocks`` down to the reasoning runs they contain."""

    return [block for block in blocks if isinstance(block, ThinkingContent)]


def _tool_call_blocks(blocks: Sequence[object]) -> list[ToolCall]:
    """Filter ``blocks`` down to the tool calls they contain."""

    return [block for block in blocks if isinstance(block, ToolCall)]


def has_tool_history(messages: Sequence[object]) -> bool:
    """Whether the conversation already contains a tool call or a tool result.

    An Anthropic request reached through a proxy rejects a message array that contains tool
    turns unless the ``tools`` field is also present, even when no tool is currently declared,
    so the caller needs this answer to send an empty ``tools`` array instead of omitting the
    field.
    """

    for message in messages:
        if isinstance(message, ToolResultMessage):
            return True
        if isinstance(message, AssistantMessage) and any(
            isinstance(block, ToolCall) for block in message.content
        ):
            return True
    return False


# ---------------------------------------------------------------------------
# Replayed reasoning details
# ---------------------------------------------------------------------------


def _is_json_number(value: object) -> TypeGuard[int | float]:
    """Whether ``value`` narrows to a JSON number rather than a boolean or another type."""

    return not isinstance(value, bool) and isinstance(value, (int, float))


def _has_valid_common_reasoning_detail_fields(candidate: Mapping[str, JsonValue]) -> bool:
    """Whether the identifying fields of a reasoning detail have usable types.

    An absent field is fine; a present one must have the type the protocol assigns it. An
    explicit null is tolerated only for the identifier, which is what a replayed payload may
    carry there.
    """

    identifier = candidate.get("id")
    if identifier is not None and not isinstance(identifier, str):
        return False
    detail_format = candidate.get("format")
    if detail_format is not None and not isinstance(detail_format, str):
        return False
    index = candidate.get("index")
    return index is None or _is_json_number(index)


def isOpenAIReasoningDetail(detail: object) -> bool:
    """Whether ``detail`` is one replayable reasoning detail.

    A detail is a JSON object whose identifying fields have the right types and whose body
    matches its own ``type``: a summary, an encrypted blob, or signed reasoning text.
    """

    if not isinstance(detail, dict):
        return False
    candidate = cast("dict[str, JsonValue]", detail)
    if not _has_valid_common_reasoning_detail_fields(candidate):
        return False

    detail_type = candidate.get("type")
    if detail_type == "reasoning.summary":
        return isinstance(candidate.get("summary"), str)
    if detail_type == "reasoning.encrypted":
        return isinstance(candidate.get("data"), str)
    if detail_type == "reasoning.text":
        if not isinstance(candidate.get("text"), str):
            return False
        signature = candidate.get("signature")
        return signature is None or isinstance(signature, str)
    return False


def _parse_openai_reasoning_details(signature: str | None) -> list[JsonValue] | None:
    """Decode a thinking block's signature into reasoning details.

    The signature field carries either an opaque provider value or a JSON array of details.
    Only the non-empty array whose every entry is valid is replay metadata; anything else means
    the signature has some other meaning and must be passed through untouched.
    """

    if not signature:
        return None
    try:
        parsed: object = json.loads(signature)
    except ValueError:
        # A signature that is not JSON at all is an opaque provider value, not a detail list.
        return None
    if not isinstance(parsed, list):
        return None
    details = cast("list[JsonValue]", parsed)
    if len(details) == 0 or not all(isOpenAIReasoningDetail(entry) for entry in details):
        return None
    return details


def _parse_legacy_encrypted_reasoning_detail(signature: str | None) -> JsonValue | None:
    """Decode a tool call's thought signature into one encrypted reasoning detail.

    Older sessions stored the encrypted reasoning of a whole turn on the tool call instead of
    on the thinking block. Only a non-empty identifier and payload make it replayable.
    """

    if not signature:
        return None
    try:
        parsed: object = json.loads(signature)
    except ValueError:
        return None
    if not isOpenAIReasoningDetail(parsed) or not isinstance(parsed, dict):
        return None
    detail = cast("dict[str, JsonValue]", parsed)
    if detail.get("type") != "reasoning.encrypted":
        return None
    identifier = detail.get("id")
    if not isinstance(identifier, str) or len(identifier) == 0:
        return None
    data = detail.get("data")
    if not isinstance(data, str) or len(data) == 0:
        return None
    return detail


def _is_openai_completions_reasoning_field(field: str) -> bool:
    """Whether ``field`` is one of the names a thinking signature may name."""

    return field in _REASONING_FIELDS


# ---------------------------------------------------------------------------
# Prompt cache retention
# ---------------------------------------------------------------------------


def resolveCacheRetention(
    cacheRetention: CacheRetention | None = None,
    env: ProviderEnv | None = None,
) -> CacheRetention:
    """Resolve how long the provider should keep the prompt cached.

    The caller's preference wins; otherwise an environment opt-in asks for the long window,
    and everything else gets the short one.
    """

    if cacheRetention:
        return cacheRetention
    if getProviderEnvValue("PI_CACHE_RETENTION", env) == "long":
        return CacheRetention.LONG
    return CacheRetention.SHORT


def getCompatCacheControl(
    compat: OpenAICompletionsCompat,
    cacheRetention: CacheRetention,
) -> CacheControl | None:
    """Build the prompt-cache marker for a server that reads Anthropic's marker format.

    Only that format is understood, and an unset retention means the caller wants no cache
    marker at all rather than the default one.
    """

    if compat.cacheControlFormat != "anthropic" or cacheRetention == CacheRetention.NONE:
        return None

    marker: CacheControl = {"type": "ephemeral"}
    if cacheRetention == CacheRetention.LONG and compat.supportsLongCacheRetention:
        # A key present with no value would be serialized as null, so the extended lifetime is
        # added only when it was actually requested.
        marker["ttl"] = "1h"
    return marker


def _is_tool_message(message: ChatMessage) -> TypeGuard[ChatMessageTool]:
    """Whether a message mapping has the shape of a tool result."""

    return cast("Mapping[str, object]", message)["role"] == "tool"


def _is_user_message(message: ChatMessage) -> TypeGuard[ChatMessageUser]:
    """Whether a message mapping has the shape of a user turn."""

    return cast("Mapping[str, object]", message)["role"] == "user"


def _is_assistant_message(message: ChatMessage) -> TypeGuard[ChatMessageAssistant]:
    """Whether a message mapping has the shape of an assistant turn."""

    return cast("Mapping[str, object]", message)["role"] == "assistant"


def _message_role(message: ChatMessage) -> str:
    """The role a message mapping was built with, whatever concrete shape it has."""

    if _is_tool_message(message):
        return message["role"]
    if _is_user_message(message):
        return message["role"]
    return message["role"]


def _text_part(text: str, cacheControl: CacheControl | None = None) -> ChatContentPartText:
    """Build one text part, optionally marked as cacheable."""

    part: ChatContentPartText = {"type": "text", "text": text}
    if cacheControl is not None:
        part["cache_control"] = cacheControl
    return part


def _mark_part(part: ChatContentPart, cacheControl: CacheControl) -> bool:
    """Mark one content part as cacheable, reporting whether it was a text part."""

    if part.get("type") != "text":
        return False
    cast("ChatContentPartText", part)["cache_control"] = cacheControl
    return True


def _mark_text_content(
    content: str | list[ChatContentPart] | None,
    cacheControl: CacheControl,
) -> tuple[bool, str | list[ChatContentPart] | None]:
    """Mark the last text of one content value.

    Reports whether anything was marked, together with the content value to store back: a
    plain string becomes a one-part array so the marker has somewhere to live, and an existing
    array gets the marker on its last text part. A value that cannot carry the marker is
    returned unchanged.
    """

    if isinstance(content, str):
        if len(content) == 0:
            return False, content
        return True, [_text_part(content, cacheControl)]

    if not isinstance(content, list):
        return False, content

    for part in reversed(content):
        if _mark_part(part, cacheControl):
            return True, content

    return False, content


def _mark_tool_text(message: ChatMessageTool, cacheControl: CacheControl) -> bool:
    """Mark the text of a tool result, reporting whether anything was marked."""

    marked, content = _mark_text_content(message["content"], cacheControl)
    if marked:
        message["content"] = cast("str", content)
    return marked


def _mark_user_text(message: ChatMessageUser, cacheControl: CacheControl) -> bool:
    """Mark the text of a user turn, reporting whether anything was marked."""

    marked, content = _mark_text_content(message["content"], cacheControl)
    if marked:
        message["content"] = cast("str | list[ChatContentPart]", content)
    return marked


def _mark_assistant_text(message: ChatMessageAssistant, cacheControl: CacheControl) -> bool:
    """Mark the text of an assistant turn, reporting whether anything was marked."""

    marked, content = _mark_text_content(message["content"], cacheControl)
    if marked:
        message["content"] = content
    return marked


def addCacheControlToTextContent(
    message: ChatMessageUser | ChatMessageAssistant | ChatMessageTool,
    cacheControl: CacheControl,
) -> bool:
    """Mark the last text of ``message`` as cacheable, reporting whether anything was marked.

    A message whose content is a plain string is rewritten as a one-part array so the marker
    has somewhere to live. Content that is already an array gets the marker on its last text
    part. A message with no text at all cannot carry a marker.
    """

    if _is_tool_message(message):
        return _mark_tool_text(message, cacheControl)
    if _is_user_message(message):
        return _mark_user_text(message, cacheControl)
    if _is_assistant_message(message):
        return _mark_assistant_text(message, cacheControl)
    return False


def addCacheControlToInstructionMessage(
    message: ChatMessageAssistant,
    cacheControl: CacheControl,
) -> bool:
    """Mark the last text of a leading instruction message as cacheable."""

    return addCacheControlToTextContent(message, cacheControl)


def addCacheControlToMessage(
    message: ChatMessage,
    cacheControl: CacheControl,
) -> bool:
    """Mark the last text of one conversation message as cacheable.

    Only a turn the model reads as conversation can carry the marker. An instruction message
    is handled separately, because it is the reusable prompt rather than a turn.
    """

    if _is_assistant_message(message):
        return addCacheControlToTextContent(message, cacheControl)
    if _is_user_message(message):
        return addCacheControlToTextContent(message, cacheControl)
    if _is_tool_message(message):
        return addCacheControlToTextContent(message, cacheControl)
    return False


def addCacheControlToSystemPrompt(
    messages: list[ChatMessage],
    cacheControl: CacheControl,
) -> None:
    """Mark the prompt at the head of the request as cacheable.

    The first instruction message is the one worth caching: it is the part that repeats
    unchanged across the turns of a conversation. An instruction message shares its mapping
    shape with an assistant turn, so the shape guard is what reads it back.
    """

    for message in messages:
        if _message_role(message) in ("system", "developer"):
            addCacheControlToInstructionMessage(
                cast("ChatMessageAssistant", message), cacheControl
            )
            return


def addCacheControlToLastTool(
    tools: list[ChatTool] | None,
    cacheControl: CacheControl,
) -> None:
    """Mark the last declared tool as cacheable.

    The tool declarations form a single cached prefix, so only its end needs the marker.
    """

    if not tools:
        return
    tools[-1]["cache_control"] = cacheControl


def addCacheControlToLastConversationMessage(
    messages: list[ChatMessage],
    cacheControl: CacheControl,
) -> None:
    """Mark the newest conversation turn as cacheable, walking back until one can carry it."""

    for index in range(len(messages) - 1, -1, -1):
        if addCacheControlToMessage(messages[index], cacheControl):
            return


def applyAnthropicCacheControl(
    messages: list[ChatMessage],
    tools: list[ChatTool] | None,
    cacheControl: CacheControl,
) -> None:
    """Place the cache markers on the three parts of a request worth caching.

    The instruction prompt, the tool declarations and the newest turn are the boundaries where
    a server can cut a reusable prefix, so each end gets one marker.
    """

    addCacheControlToSystemPrompt(messages, cacheControl)
    addCacheControlToLastTool(tools, cacheControl)
    addCacheControlToLastConversationMessage(messages, cacheControl)


# ---------------------------------------------------------------------------
# Thinking budget and chat-template keywords
# ---------------------------------------------------------------------------


def resolveThinkingTokenBudgetField(
    compat: OpenAICompletionsCompat,
) -> ThinkingTokenBudgetField | None:
    """The top-level field that caps reasoning tokens, when the server has one.

    An explicit field name wins; otherwise a server that only advertises support gets the
    protocol's default name. ``None`` means the server caps nothing this way.
    """

    if compat.thinkingTokenBudgetField is not None:
        return compat.thinkingTokenBudgetField
    if compat.supportsThinkingTokenBudget:
        return ThinkingTokenBudgetField.THINKING_TOKEN_BUDGET
    return None


def thinkingBudgetForLevel(
    reasoningLevel: ThinkingLevel,
    customBudgets: ThinkingBudgets | None = None,
) -> int:
    """The token budget for one thinking level.

    The caller's per-level overrides replace the defaults one level at a time, so a caller that
    customizes a single level keeps the defaults for the others. The two highest levels clamp
    down to ``high``, the highest level the table defines.
    """

    budgets = dict(_DEFAULT_THINKING_BUDGETS)
    if customBudgets is not None:
        custom: dict[ThinkingLevel, int | None] = {
            ThinkingLevel.MINIMAL: customBudgets.minimal,
            ThinkingLevel.LOW: customBudgets.low,
            ThinkingLevel.MEDIUM: customBudgets.medium,
            ThinkingLevel.HIGH: customBudgets.high,
        }
        for level, value in custom.items():
            if value is not None:
                budgets[level] = value

    level = (
        ThinkingLevel.HIGH
        if reasoningLevel in (ThinkingLevel.XHIGH, ThinkingLevel.MAX)
        else reasoningLevel
    )
    return budgets[level]


def resolveClampedThinkingBudget(
    model: Model,
    options: OpenAICompletionsOptions | None,
    params: dict[str, object],
) -> int | None:
    """The reasoning-token budget to send, capped so that an answer still fits.

    Reasoning and the answer share one response ceiling, so an uncapped reasoning phase can
    consume the whole response and leave neither an answer nor a tool call. The budget is
    therefore clamped to leave room, and a budget that clamps to zero is dropped rather than
    sent.
    """

    if not options or not options.reasoningEffort or not model.reasoning:
        return None

    # An explicit ceiling wins over the model's own limit; the protocol has two names for it.
    ceilingValue = params.get("max_tokens") or params.get("max_completion_tokens")
    ceiling = int(ceilingValue) if _is_json_number(ceilingValue) else model.maxTokens

    budget = thinkingBudgetForLevel(options.reasoningEffort, options.thinkingBudgets)
    clamped = min(budget, max(0, ceiling - _MIN_ANSWER_TOKENS))
    return clamped if clamped > 0 else None


def _level_map(model: Model) -> dict[ThinkingLevel, str | None] | None:
    """The model's thinking-level map, viewed through the levels a caller can ask for.

    The map is also able to describe the "off" state, which is not a level a caller requests,
    so the view names only the levels this module looks up.
    """

    mapping = model.thinkingLevelMap
    return cast("dict[ThinkingLevel, str | None]", mapping) if mapping is not None else None


def _mapped_effort(
    model: Model,
    effort: ThinkingLevel,
    fallback: str | None,
) -> str | None:
    """Look an effort level up in the model's level map, keeping "absent" distinct from "off".

    A model maps a level to the string its provider accepts, maps it to nothing when the level
    is unsupported, or leaves the level out. A missing level falls back to the caller's own
    value, while an explicit mapping to nothing means no value may be sent at all.
    """

    mapping = _level_map(model)
    if mapping is None or effort not in mapping:
        return fallback
    mapped = mapping[effort]
    return mapped if isinstance(mapped, str) else None


def _mapped_off_effort(model: Model, fallback: str) -> str | None:
    """What the model sends when thinking is off, with ``fallback`` used when it maps nothing."""

    mapping = model.thinkingLevelMap
    if mapping is None or ModelThinkingLevel.OFF not in mapping:
        return fallback
    mapped = mapping[ModelThinkingLevel.OFF]
    return mapped if isinstance(mapped, str) else None


def _map_effort_or_none(model: Model, effort: ThinkingLevel) -> str | None:
    """What the model sends for ``effort``, or ``None`` when it maps the level to nothing."""

    mapping = _level_map(model)
    if mapping is None or effort not in mapping:
        return None
    mapped = mapping[effort]
    return mapped if isinstance(mapped, str) else None


def buildChatTemplateValues(
    model: Model,
    options: OpenAICompletionsOptions | None,
    values: Mapping[str, ChatTemplateKwargValue],
    thinkingBudget: int | None = None,
) -> dict[str, ResolvedChatTemplateKwargValue] | None:
    """Resolve every chat-template keyword argument for this request.

    Entries that resolve to nothing are dropped, and a mapping left empty is reported as absent
    so the caller omits the field entirely rather than sending an empty object.
    """

    resolvedValues: dict[str, ResolvedChatTemplateKwargValue] = {}
    for key, value in values.items():
        resolved = resolveChatTemplateKwargValue(model, options, value, thinkingBudget)
        if resolved is not None:
            resolvedValues[key] = resolved

    return resolvedValues if len(resolvedValues) > 0 else None


def resolveChatTemplateKwargValue(
    model: Model,
    options: OpenAICompletionsOptions | None,
    value: ChatTemplateKwargValue,
    thinkingBudget: int | None = None,
) -> ResolvedChatTemplateKwargValue | None:
    """Resolve one chat-template keyword argument to the value the template receives.

    A literal value is passed through. A variable reference is replaced by the value it stands
    for, and is dropped when it is marked as omitted while thinking is off. Anything else falls
    back to the model's map for the requested effort level.
    """

    if not isinstance(value, ChatTemplateVar):
        return value

    reasoningEffort = options.reasoningEffort if options is not None else None
    if not reasoningEffort and value.omitWhenOff:
        return None
    if value.var == "thinking.enabled":
        return bool(reasoningEffort)
    if value.var == "thinking.budget":
        return thinkingBudget

    if reasoningEffort:
        return _mapped_effort(model, reasoningEffort, reasoningEffort)
    return _mapped_off_effort(model, "")


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


def convertTools(
    tools: list[Tool],
    compat: OpenAICompletionsCompat,
) -> list[ChatTool]:
    """Convert tool declarations into the request's ``tools`` array.

    A tool constrained by a grammar becomes a custom tool whose format carries the grammar
    itself, because a JSON-schema declaration cannot express one. Every other tool becomes a
    function declaration, with the strict flag included only when the server understands it.
    """

    converted: list[ChatTool] = []
    for tool in tools:
        grammar = resolve_grammar_constrained_sampling(
            tool, bool(compat.supportsOpenAIGrammarTools)
        )
        if grammar is not None:
            converted.append(
                {
                    "type": "custom",
                    "custom": {
                        "name": tool.name,
                        "description": tool.description,
                        "format": {
                            "type": "grammar",
                            "grammar": {
                                "syntax": grammar.format,
                                "definition": grammar.definition,
                            },
                        },
                    },
                }
            )
            continue

        strict = resolve_json_schema_strict_sampling(tool, compat.supportsStrictMode is not False)
        function: ChatToolFunction = {
            "name": tool.name,
            "description": tool.description,
            "parameters": get_json_schema_tool_parameters(tool, strict),
        }
        if compat.supportsStrictMode is not False:
            # Only include strict when the server supports it: some reject unknown fields.
            function["strict"] = strict if strict is not None else False
        converted.append({"type": "function", "function": function})

    return converted


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


def _convert_tool_call(
    toolCall: ToolCall,
    grammarToolInputProperties: Mapping[str, str] | None,
) -> dict[str, object]:
    """Convert one tool call of an assistant turn into its replayed form.

    A grammar-constrained call declares its argument as the raw grammar input string rather
    than as a JSON object, because that string is exactly what the model produced.
    """

    customInputProperty = (
        grammarToolInputProperties.get(toolCall.name)
        if grammarToolInputProperties is not None
        else None
    )
    if customInputProperty is not None:
        return {
            "id": toolCall.id,
            "type": "custom",
            "custom": {
                "name": toolCall.name,
                "input": sanitizeSurrogates(
                    get_grammar_tool_input(toolCall.name, toolCall.arguments, customInputProperty)
                ),
            },
        }
    return {
        "id": toolCall.id,
        "type": "function",
        "function": {
            "name": toolCall.name,
            "arguments": json.dumps(toolCall.arguments),
        },
    }


def _image_part(block: ImageContent) -> ChatContentPartImage:
    """Wrap an inline image as the data-URL part the protocol accepts."""

    return {
        "type": "image_url",
        "image_url": {"url": f"data:{block.mimeType};base64,{block.data}"},
    }


def convertMessages(
    model: Model,
    context: TranscriptContext,
    compat: OpenAICompletionsCompat,
    grammarToolInputProperties: Mapping[str, str] | None = None,
) -> list[ChatMessage]:
    """Convert the transcript into the protocol's message array.

    Each turn is translated according to what the target server accepts: instructions may be
    sent in the developer role, reasoning is replayed through whichever field the model
    understands, a run of tool results is grouped and followed by its images as a separate user
    turn, and provider-specific shapes are smoothed over. ``compat`` carries the per-provider
    answers to all of those questions.
    """

    normalizedContext = resolve_transcript(context, compat.supportsMidConvoSystemMessages)
    params: list[ChatMessage] = []

    def normalizeToolCallId(
        identifier: str,
        _model: Model,
        _source: AssistantMessage,
    ) -> str:
        """Rewrite a tool call identifier into the shape this protocol accepts.

        A replayed identifier can be a composite of a provider's call id and its own item id,
        and can be far longer than this protocol allows. The composite form is split, both
        halves are reduced to the allowed alphabet, and the result is truncated against a hash
        so that two calls that shared a call id stay distinct. Only the identifier is used: the
        shape this protocol accepts does not depend on the message it came from.
        """

        if "|" in identifier:
            separatorIndex = identifier.index("|")
            callId = _DISALLOWED_TOOL_CALL_ID_CHARS.sub("_", identifier[:separatorIndex])
            itemId = _DISALLOWED_TOOL_CALL_ID_CHARS.sub("_", identifier[separatorIndex + 1 :])
            combinedId = f"{callId}_{itemId}" if len(itemId) > 0 else callId
            if len(combinedId) <= 40:
                return combinedId
            digest = shortHash(identifier)[:8]
            prefix = callId[: max(1, 40 - len(digest) - 1)]
            return f"{prefix}_{digest}"

        if model.provider == "openai":
            return identifier[:40] if len(identifier) > 40 else identifier
        return identifier

    transformedMessages = transform_messages(
        normalizedContext.messages, model, normalizeToolCallId
    )
    transcriptTools = resolve_transcript_tools(
        normalizedContext.messages,
        compat.supportsMidConvoSystemMessages is True
        and compat.supportsMidConvoToolAdditions is True,
    )
    instructionRole = "developer" if model.reasoning and compat.supportsDeveloperRole else "system"

    lastRole: str | None = None

    index = 0
    while index < len(transformedMessages):
        msg = transformedMessages[index]
        # Some servers do not allow a user turn directly after a tool result, so a short
        # assistant acknowledgement is inserted to bridge the two.
        if (
            compat.requiresAssistantAfterToolResult
            and lastRole == "toolResult"
            and isinstance(msg, UserMessage)
        ):
            params.append({"role": "assistant", "content": "I have processed the tool results."})

        if isinstance(msg, SystemMessage):
            addedTools = (
                msg.toolsAdded or [] if index > 0 and transcriptTools.anchorsAdditions else []
            )
            if len(addedTools) > 0:
                # A server that anchors tool additions sends them inside a system message of
                # their own, ahead of the instructions that follow them.
                params.append(
                    cast(
                        "ChatMessage",
                        {"role": "system", "tools": convertTools(addedTools, compat)},
                    )
                )
            text = getSystemMessageText(msg) if index == 0 else renderSystemMessageUpdate(msg)
            if len(text) > 0:
                params.append(
                    cast(
                        "ChatMessage",
                        {"role": instructionRole, "content": sanitizeSurrogates(text)},
                    )
                )
        elif isinstance(msg, UserMessage):
            if isinstance(msg.content, str):
                params.append({"role": "user", "content": sanitizeSurrogates(msg.content)})
            else:
                userContent: list[ChatContentPart] = []
                for item in msg.content:
                    if isinstance(item, TextContent):
                        userContent.append(
                            {"type": "text", "text": sanitizeSurrogates(item.text)}
                        )
                    else:
                        userContent.append(_image_part(item))
                if len(userContent) == 0:
                    index += 1
                    continue
                params.append({"role": "user", "content": userContent})
        elif isinstance(msg, AssistantMessage):
            # Some servers do not accept a null content field, so an empty string stands in for
            # it whenever the tool-result bridging above may be needed.
            assistantMsg: ChatMessageAssistant = {
                "role": "assistant",
                "content": "" if compat.requiresAssistantAfterToolResult else None,
            }

            textBlocks = [
                block for block in _text_blocks(msg.content) if len(block.text.strip()) > 0
            ]
            assistantTextParts: list[ChatContentPartText] = [
                {"type": "text", "text": sanitizeSurrogates(block.text)} for block in textBlocks
            ]
            # The parts are sanitized already, so they join with no separator, exactly as the
            # model wrote them.
            assistantText = "".join(sanitizeSurrogates(block.text) for block in textBlocks)

            thinkingBlocks = _thinking_blocks(msg.content)
            toolCalls = _tool_call_blocks(msg.content)

            signedReasoningDetails: list[JsonValue] | None = None
            for block in thinkingBlocks:
                found = _parse_openai_reasoning_details(block.thinkingSignature)
                if found is not None:
                    signedReasoningDetails = found
                    break
            legacyReasoningDetails: list[JsonValue] = []
            for toolCall in toolCalls:
                legacyDetail = _parse_legacy_encrypted_reasoning_detail(toolCall.thoughtSignature)
                if legacyDetail is not None:
                    legacyReasoningDetails.append(legacyDetail)
            preservedReasoningDetails: list[JsonValue] | None = (
                signedReasoningDetails
                if signedReasoningDetails is not None
                else (legacyReasoningDetails if len(legacyReasoningDetails) > 0 else None)
            )

            nonEmptyThinkingBlocks = [
                block for block in thinkingBlocks if len(block.thinking.strip()) > 0
            ]
            if len(nonEmptyThinkingBlocks) > 0:
                if compat.requiresThinkingAsText:
                    # The reasoning is folded into the visible text with no tags, so a model
                    # cannot learn to imitate a marker that was never part of its output.
                    thinkingText = "\n\n".join(
                        sanitizeSurrogates(block.thinking) for block in nonEmptyThinkingBlocks
                    )
                    assistantMsg["content"] = [
                        {"type": "text", "text": thinkingText},
                        *assistantTextParts,
                    ]
                else:
                    # Assistant content travels as a plain string because the array form is
                    # non-standard, and some models then mirror the block structure literally in
                    # their own output.
                    if len(assistantText) > 0:
                        assistantMsg["content"] = assistantText

                    # ``reasoning_details`` is the structured alternative to a raw reasoning
                    # field, so only one of the two is ever populated.
                    if preservedReasoningDetails is None:
                        signature = nonEmptyThinkingBlocks[0].thinkingSignature
                        if model.provider == "opencode-go" and signature == "reasoning":
                            signature = "reasoning_content"
                        if signature and _is_openai_completions_reasoning_field(signature):
                            combined = "\n".join(
                                block.thinking for block in nonEmptyThinkingBlocks
                            )
                            # The reasoning is written back under the field name its own
                            # signature chose, which is how the server recognizes it again.
                            if signature == "reasoning":
                                assistantMsg["reasoning"] = combined
                            elif signature == "reasoning_content":
                                assistantMsg["reasoning_content"] = combined
                            else:
                                assistantMsg["reasoning_text"] = combined
            elif len(assistantText) > 0:
                assistantMsg["content"] = assistantText

            if len(toolCalls) > 0:
                assistantMsg["tool_calls"] = [
                    _convert_tool_call(toolCall, grammarToolInputProperties)
                    for toolCall in toolCalls
                ]
            if preservedReasoningDetails is not None:
                assistantMsg["reasoning_details"] = preservedReasoningDetails
            if (
                compat.requiresReasoningContentOnAssistantMessages
                and model.reasoning
                and "reasoning_content" not in assistantMsg
            ):
                assistantMsg["reasoning_content"] = ""

            # An assistant turn with neither content nor tool calls is skipped: some servers
            # require one of the two and none of them accept neither. This is what an aborted
            # response that produced nothing looks like.
            assistantContent = assistantMsg["content"]
            hasContent = (
                len(assistantContent) > 0
                if isinstance(assistantContent, str)
                else assistantContent is not None and len(assistantContent) > 0
            )
            if not hasContent and "tool_calls" not in assistantMsg:
                index += 1
                continue
            params.append(assistantMsg)
        elif isinstance(msg, ToolResultMessage):
            imageBlocks: list[ChatContentPartImage] = []
            inner = index

            while inner < len(transformedMessages):
                candidate = transformedMessages[inner]
                if not isinstance(candidate, ToolResultMessage):
                    break
                toolMsg = candidate

                textResult = "\n".join(
                    block.text for block in toolMsg.content if isinstance(block, TextContent)
                )
                hasImages = any(isinstance(block, ImageContent) for block in toolMsg.content)

                # A tool result always carries text, falling back to a placeholder so that the
                # message is never empty.
                toolResultText = (
                    textResult
                    if len(textResult) > 0
                    else ("(see attached image)" if hasImages else "(no tool output)")
                )
                toolResultMsg: ChatMessageTool = {
                    "role": "tool",
                    "content": sanitizeSurrogates(toolResultText),
                    "tool_call_id": toolMsg.toolCallId,
                }
                if compat.requiresToolResultName and toolMsg.toolName:
                    toolResultMsg["name"] = toolMsg.toolName
                params.append(toolResultMsg)

                if hasImages and "image" in model.input:
                    for imageBlock in toolMsg.content:
                        if isinstance(imageBlock, ImageContent):
                            imageBlocks.append(_image_part(imageBlock))
                inner += 1

            # The run of tool results was consumed by the inner loop.
            index = inner - 1

            if len(imageBlocks) > 0:
                if compat.requiresAssistantAfterToolResult:
                    params.append(
                        {"role": "assistant", "content": "I have processed the tool results."}
                    )
                # Images a tool produced can only be fed back as a user turn.
                params.append(
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Attached image(s) from tool result:"},
                            *imageBlocks,
                        ],
                    }
                )
                lastRole = "user"
            else:
                lastRole = "toolResult"

            index += 1
            continue

        lastRole = msg.role
        index += 1

    return params


# ---------------------------------------------------------------------------
# Request body
# ---------------------------------------------------------------------------


def _build_gateway_provider_options(model: Model) -> dict[str, object] | None:
    """The provider-routing field a gateway reads, when the model configures routing.

    Either bound is enough to build the field; a routing preference that names neither is
    dropped so that an empty object is never sent.
    """

    compat = model.compat
    routing = compat.vercelGatewayRouting if isinstance(compat, OpenAICompletionsCompat) else None
    if routing is None:
        return None

    gatewayOptions: dict[str, list[str]] = {}
    if routing.only:
        gatewayOptions["only"] = routing.only
    if routing.order:
        gatewayOptions["order"] = routing.order
    if not gatewayOptions:
        return None
    return {"gateway": gatewayOptions}


def _get_compat(model: Model) -> OpenAICompletionsCompat:
    """The compatibility settings in force for ``model``.

    A model configured for this protocol carries its own settings; anything else is treated as
    having none set, which makes every dialect decision fall back to its default.
    """

    compat = model.compat
    return compat if isinstance(compat, OpenAICompletionsCompat) else OpenAICompletionsCompat()


def createGrammarToolInputProperties(
    tools: list[Tool] | None,
    supportsOpenAIGrammarTools: bool,
) -> dict[str, str]:
    """Map each grammar-constrained tool name to the argument that carries its raw input."""

    properties: dict[str, str] = {}
    for tool in tools or []:
        grammar = resolve_grammar_constrained_sampling(tool, supportsOpenAIGrammarTools)
        if grammar is not None:
            properties[tool.name] = grammar.inputProperty
    return properties


def _to_wire_value(value: object) -> object:
    """Replace the value objects the request carries with their plain mapping form.

    Routing preferences and other option values are declared as small dataclasses, which a
    serializer does not know how to write. Turning them into their field mappings keeps the
    request body a plain tree of mappings, lists and scalars.
    """

    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    return value


def buildParams(
    model: Model,
    context: TranscriptContext,
    options: OpenAICompletionsOptions | None = None,
    compat: OpenAICompletionsCompat | None = None,
    cacheRetention: CacheRetention | None = None,
    grammarToolInputProperties: Mapping[str, str] | None = None,
) -> dict[str, object]:
    """Build the request body for one streaming Chat Completions call.

    The body is assembled field by field because each compatible server accepts a different
    subset: which reasoning dialect it speaks, how it names the output-token cap, and whether
    it wants the prompt-cache fields. ``compat`` carries those answers, and each one is applied
    only when the server actually supports it.
    """

    if compat is None:
        compat = _get_compat(model)
    if cacheRetention is None:
        cacheRetention = resolveCacheRetention(
            options.cacheRetention if options is not None else None,
            options.env if options is not None else None,
        )
    if grammarToolInputProperties is None:
        grammarToolInputProperties = createGrammarToolInputProperties(
            get_declared_tools(context.messages),
            bool(compat.supportsOpenAIGrammarTools),
        )

    transcriptTools = resolve_transcript_tools(
        context.messages,
        compat.supportsMidConvoSystemMessages is True
        and compat.supportsMidConvoToolAdditions is True,
    )
    messages = convertMessages(model, context, compat, grammarToolInputProperties)
    cacheControl = getCompatCacheControl(compat, cacheRetention)

    params: dict[str, object] = {
        "model": model.id,
        "messages": messages,
        "stream": True,
    }

    # The prompt cache key is only meaningful where the server can act on it: the OpenAI
    # endpoint itself, or a server that keeps the long window.
    if ("api.openai.com" in model.baseUrl and cacheRetention != CacheRetention.NONE) or (
        cacheRetention == CacheRetention.LONG and bool(compat.supportsLongCacheRetention)
    ):
        sessionId = options.sessionId if options is not None else None
        promptCacheKey = clamp_openai_prompt_cache_key(sessionId)
        if promptCacheKey is not None:
            params["prompt_cache_key"] = promptCacheKey
    if cacheRetention == CacheRetention.LONG and bool(compat.supportsLongCacheRetention):
        params["prompt_cache_retention"] = "24h"

    if compat.supportsUsageInStreaming is not False:
        params["stream_options"] = {"include_usage": True}

    if compat.supportsStore:
        params["store"] = False

    if options is not None and options.maxTokens:
        if compat.maxTokensField == "max_tokens":
            params["max_tokens"] = options.maxTokens
        else:
            params["max_completion_tokens"] = options.maxTokens

    if options is not None and options.temperature is not None:
        params["temperature"] = options.temperature

    if len(transcriptTools.requestTools) > 0:
        params["tools"] = convertTools(transcriptTools.requestTools, compat)
        if compat.zaiToolStream:
            params["tool_stream"] = True
    elif has_tool_history(context.messages):
        # A proxied Anthropic request rejects tool turns unless the tools field is present, even
        # when the current turn declares no tools.
        params["tools"] = []

    if cacheControl is not None:
        applyAnthropicCacheControl(
            messages,
            cast("list[ChatTool] | None", params.get("tools")),
            cacheControl,
        )

    if options is not None and options.toolChoice:
        params["tool_choice"] = options.toolChoice

    if compat.vllmPriority is not None:
        params["priority"] = compat.vllmPriority

    thinkingTokenBudgetField = resolveThinkingTokenBudgetField(compat)
    thinkingBudget = resolveClampedThinkingBudget(model, options, params)

    # Each server expresses reasoning through its own field, so the same caller option is
    # translated once per dialect. Only the first matching dialect applies.
    if compat.thinkingFormat == "zai" and model.reasoning:
        params["thinking"] = (
            {"type": "enabled", "clear_thinking": False}
            if options is not None and options.reasoningEffort
            else {"type": "disabled"}
        )
        if options is not None and options.reasoningEffort and compat.supportsReasoningEffort:
            zaiEffort = _map_effort_or_none(model, options.reasoningEffort)
            if zaiEffort is not None:
                params["reasoning_effort"] = zaiEffort
    elif compat.thinkingFormat == "qwen" and model.reasoning:
        params["enable_thinking"] = bool(options is not None and options.reasoningEffort)
        if options is not None and options.reasoningEffort and compat.supportsReasoningEffort:
            qwenEffort = _mapped_effort(model, options.reasoningEffort, options.reasoningEffort)
            if qwenEffort is not None:
                params["reasoning_effort"] = qwenEffort
    elif compat.thinkingFormat == "qwen-chat-template" and model.reasoning:
        params["chat_template_kwargs"] = {
            "enable_thinking": bool(options is not None and options.reasoningEffort),
            "preserve_thinking": True,
        }
    elif compat.thinkingFormat == "chat-template" and model.reasoning:
        chatTemplateKwargs = buildChatTemplateValues(
            model, options, compat.chatTemplateKwargs or {}, thinkingBudget
        )
        if chatTemplateKwargs is not None:
            params["chat_template_kwargs"] = chatTemplateKwargs
    elif compat.thinkingFormat == "baseten" and model.reasoning:
        chatTemplateArgs = buildChatTemplateValues(
            model, options, compat.chatTemplateArgs or {}, thinkingBudget
        )
        if chatTemplateArgs is not None:
            params["chat_template_args"] = chatTemplateArgs
        if compat.supportsReasoningEffort:
            requestedEffort = options.reasoningEffort if options is not None else None
            # With no level requested the model's own "off" value is what gets sent.
            basetenEffort = (
                _mapped_effort(model, requestedEffort, requestedEffort)
                if requestedEffort
                else _mapped_off_effort(model, "")
            )
            if basetenEffort is not None:
                params["reasoning_effort"] = basetenEffort
    elif compat.thinkingFormat == "deepseek" and model.reasoning:
        if options is not None and options.reasoningEffort:
            params["thinking"] = {"type": "enabled"}
        elif _mapped_off_effort(model, "") is not None:
            # The model maps "off" to nothing, which means the server has no disabled form.
            params["thinking"] = {"type": "disabled"}
        if options is not None and options.reasoningEffort and compat.supportsReasoningEffort:
            deepseekEffort = _map_effort_or_none(model, options.reasoningEffort)
            if deepseekEffort is not None:
                params["reasoning_effort"] = deepseekEffort
    elif compat.thinkingFormat == "openrouter" and model.reasoning:
        # OpenRouter normalizes reasoning across its providers through one nested object.
        if options is not None and options.reasoningEffort:
            params["reasoning"] = {"effort": _map_effort_or_none(model, options.reasoningEffort)}
        else:
            openRouterOff = _mapped_off_effort(model, "none")
            if openRouterOff is not None:
                params["reasoning"] = {"effort": openRouterOff}
    elif (
        compat.thinkingFormat == "ant-ling"
        and model.reasoning
        and options is not None
        and options.reasoningEffort
    ):
        # This dialect only accepts an explicit level, so nothing is sent when thinking is off.
        antLingEffort = _map_effort_or_none(model, options.reasoningEffort)
        if antLingEffort is not None:
            params["reasoning"] = {"effort": antLingEffort}
    elif compat.thinkingFormat == "together" and model.reasoning:
        params["reasoning"] = {"enabled": bool(options is not None and options.reasoningEffort)}
        if options is not None and options.reasoningEffort and compat.supportsReasoningEffort:
            params["reasoning_effort"] = _mapped_effort(
                model, options.reasoningEffort, options.reasoningEffort
            )
    elif compat.thinkingFormat == "string-thinking" and model.reasoning:
        if options is not None and options.reasoningEffort:
            params["thinking"] = _map_effort_or_none(model, options.reasoningEffort)
        else:
            stringThinkingOff = _mapped_off_effort(model, "none")
            if stringThinkingOff is not None:
                params["thinking"] = stringThinkingOff
    elif (
        options is not None
        and options.reasoningEffort
        and model.reasoning
        and compat.supportsReasoningEffort
    ):
        # The OpenAI-style top-level field.
        params["reasoning_effort"] = _mapped_effort(
            model, options.reasoningEffort, options.reasoningEffort
        )
    elif (
        (options is None or not options.reasoningEffort)
        and model.reasoning
        and compat.supportsReasoningEffort
    ):
        offValue = _mapped_off_effort(model, "")
        if offValue is not None:
            params["reasoning_effort"] = offValue

    # Cap reasoning with a top-level budget field. This is independent of the dialect above:
    # the same server can serve several model families. Reasoning and the answer share the
    # response ceiling here, so an uncapped reasoning phase can consume the whole response and
    # leave neither an answer nor a tool call.
    if thinkingTokenBudgetField is not None and thinkingBudget is not None:
        params[thinkingTokenBudgetField] = thinkingBudget

    # Provider routing preferences, read from the model's own configuration.
    if isinstance(model.compat, OpenAICompletionsCompat) and model.compat.openRouterRouting:
        params["provider"] = _to_wire_value(model.compat.openRouterRouting)

    if isinstance(model.compat, OpenAICompletionsCompat) and model.compat.vercelGatewayRouting:
        gatewayOptions = _build_gateway_provider_options(model)
        if gatewayOptions is not None:
            params["providerOptions"] = gatewayOptions

    # Last, so caller-supplied keys override every named field above.
    if options is not None and options.samplingParams:
        params.update(options.samplingParams)

    return params
