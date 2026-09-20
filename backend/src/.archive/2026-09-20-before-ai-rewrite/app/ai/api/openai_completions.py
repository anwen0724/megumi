"""The OpenAI Chat Completions protocol: its stream, its stop reasons and its usage.

This adapter speaks one wire format. It receives the server's streamed chunks and turns
them into the layer's events, which is where the protocol's vocabulary disappears: a
`finish_reason` becomes a stop reason, reasoning text that arrives under three different
field names becomes a thinking block, and tool-call argument fragments become one parsed
object.

The stream is consumed through a caller-supplied callable that yields decoded chunks
rather than through an HTTP client, so the adapter can be driven without a network and the
transport stays a separate concern.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import fields
from typing import Any, Literal, cast

from app.ai.api.openai_completions_params import (
    buildParams,
    createGrammarToolInputProperties,
    resolveCacheRetention,
)
from app.ai.api.simple_options import build_base_options, clamp_reasoning
from app.ai.types import (
    AssistantMessage,
    CacheRetention,
    EventDone,
    EventError,
    EventStart,
    EventTextDelta,
    EventTextEnd,
    EventTextStart,
    EventThinkingDelta,
    EventThinkingEnd,
    EventThinkingStart,
    EventToolCallDelta,
    EventToolCallEnd,
    EventToolCallStart,
    Model,
    ModelCostRates,
    OpenAICompletionsCompat,
    OpenAICompletionsOptions,
    ProviderResponse,
    SimpleStreamOptions,
    StopReason,
    StreamOptions,
    TextContent,
    ThinkingContent,
    ToolCall,
    TranscriptContext,
    Usage,
    UsageCost,
)
from app.ai.utils.error_body import formatProviderError, normalizeProviderError
from app.ai.utils.event_stream import AssistantMessageEventStream
from app.ai.utils.json_parse import parse_streaming_json
from app.ai.utils.provider_retry import ProviderRetryOptions, retryProviderRequest
from app.ai.utils.transcript import resolve_transcript

__all__ = [
    "ChunkStreamFactory",
    "HttpTransport",
    "OpenedStream",
    "StreamRequest",
    "calculate_cost",
    "map_stop_reason",
    "parse_chunk_usage",
    "resolve_cache_retention",
    "resolve_compat",
    "stream",
    "stream_simple",
]

# The reasons a successful stream can end with, and the two an unsuccessful one can.
TerminalStopReason = Literal["stop", "length", "toolUse", "deferred"]
ErrorStopReason = Literal["aborted", "error"]

# The field names different servers use for the same reasoning text. The first non-empty one
# wins, so a server reporting the text under two names is not counted twice.
REASONING_FIELDS = ("reasoning_content", "reasoning", "reasoning_text")

# Keeps references to the state-machine runners so none is collected before it finishes.
_RUNNERS: set[Any] = set()


class StreamRequest:
    """The HTTP request one completion needs, ready for a transport to send."""

    def __init__(
        self,
        url: str,
        headers: Mapping[str, str],
        body: dict[str, Any],
        options: OpenAICompletionsOptions | None,
    ) -> None:
        self.url = url
        self.headers = headers
        self.body = body
        self.options = options


class OpenedStream:
    """The response a transport received, together with the chunks it produced."""

    def __init__(
        self,
        response: ProviderResponse,
        chunks: AsyncIterator[Any],
    ) -> None:
        self.response = response
        self.chunks = chunks


ChunkStreamFactory = Callable[[StreamRequest], Awaitable[OpenedStream]]
HttpTransport = ChunkStreamFactory


def _empty_usage() -> Usage:
    """A usage block for a message that has not reported usage yet."""

    return Usage(
        input=0,
        output=0,
        cacheRead=0,
        cacheWrite=0,
        totalTokens=0,
        cost=UsageCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0, total=0.0),
    )


def _number(value: Any) -> int:
    """A token count, treating anything that is not a number as zero."""

    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _first_number(*values: Any) -> int:
    """The first value that is a number, or zero when none is."""

    for value in values:
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return 0


def calculate_cost(model: Model, usage: Usage) -> UsageCost:
    """Price a usage block with the model's rates, applying a tier when one matches.

    The highest matching input threshold applies to the whole request, not only to the
    tokens above it. Input, cache reads and cache writes all count toward the threshold.
    """

    input_tokens = usage.input + usage.cacheRead + usage.cacheWrite
    rates: ModelCostRates = model.cost
    matched_threshold = -1
    for tier in model.cost.tiers or []:
        if input_tokens > tier.inputTokensAbove and tier.inputTokensAbove > matched_threshold:
            rates = tier
            matched_threshold = tier.inputTokensAbove

    # A cache write held for an hour costs twice the base input rate; only the shorter
    # writes use the cache-write rate.
    long_write = usage.cacheWrite1h or 0
    short_write = usage.cacheWrite - long_write
    cost = UsageCost(
        input=(rates.input / 1_000_000) * usage.input,
        output=(rates.output / 1_000_000) * usage.output,
        cacheRead=(rates.cacheRead / 1_000_000) * usage.cacheRead,
        cacheWrite=(rates.cacheWrite * short_write + rates.input * 2 * long_write) / 1_000_000,
        total=0.0,
    )
    cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite
    return cost


def parse_chunk_usage(raw: Mapping[str, Any], model: Model) -> Usage:
    """Turn a chunk's usage report into a usage block.

    Providers disagree about where the cache counters live: OpenAI and OpenRouter nest
    ``cached_tokens`` under ``prompt_tokens_details``, DeepSeek uses
    ``prompt_cache_hit_tokens``, and some servers put ``cached_tokens`` at the top level.
    Cached tokens are reads rather than writes, so one is not subtracted from the other.
    The reported prompt count already includes the cache reads, so the input count is what
    is left after removing them.
    """

    prompt_tokens = _number(raw.get("prompt_tokens"))
    details = raw.get("prompt_tokens_details")
    details_map: Mapping[str, Any] = details if isinstance(details, Mapping) else {}
    cache_read = _first_number(
        details_map.get("cached_tokens"),
        raw.get("prompt_cache_hit_tokens"),
        raw.get("cached_tokens"),
    )
    cache_write = _number(details_map.get("cache_write_tokens"))
    input_tokens = max(0, prompt_tokens - cache_read - cache_write)

    # The reported completion count already includes the reasoning tokens.
    output_tokens = _number(raw.get("completion_tokens"))
    completion_details = raw.get("completion_tokens_details")
    completion_map: Mapping[str, Any] = (
        completion_details if isinstance(completion_details, Mapping) else {}
    )
    reasoning = _number(completion_map.get("reasoning_tokens"))

    usage = Usage(
        input=input_tokens,
        output=output_tokens,
        cacheRead=cache_read,
        cacheWrite=cache_write,
        totalTokens=input_tokens + output_tokens + cache_read + cache_write,
        cost=UsageCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0, total=0.0),
        reasoning=reasoning,
    )
    usage.cost = calculate_cost(model, usage)
    return usage


def map_stop_reason(reason: Any) -> tuple[StopReason, str | None]:
    """Map the protocol's finish reason onto the layer's stop reason.

    An unrecognized reason is reported as an error rather than treated as a clean stop,
    because callers decide whether to retry from this value.
    """

    if reason is None:
        return StopReason.STOP, None
    if reason in ("stop", "end"):
        return StopReason.STOP, None
    if reason == "length":
        return StopReason.LENGTH, None
    if reason in ("function_call", "tool_calls"):
        return StopReason.TOOL_USE, None
    if reason == "content_filter":
        return StopReason.ERROR, "Provider finish_reason: content_filter"
    if reason == "network_error":
        return StopReason.ERROR, "Provider finish_reason: network_error"
    return StopReason.ERROR, f"Provider finish_reason: {reason}"


def resolve_compat(model: Model) -> OpenAICompletionsCompat:
    """The compatibility settings to use, filling unset ones with their defaults.

    A caller that has not stated a preference gets the behaviour of the endpoints this
    adapter was written against, so an unset field never silently changes the request.
    """

    declared = model.compat
    settings = (
        declared if isinstance(declared, OpenAICompletionsCompat) else OpenAICompletionsCompat()
    )
    defaults = OpenAICompletionsCompat(
        supportsDeveloperRole=False,
        supportsReasoningEffort=False,
        supportsUsageInStreaming=settings.supportsUsageInStreaming,
        supportsFinishReason=settings.supportsFinishReason,
        maxTokensField=settings.maxTokensField or "max_completion_tokens",
        requiresToolResultName=settings.requiresToolResultName or False,
        requiresAssistantAfterToolResult=settings.requiresAssistantAfterToolResult or False,
        requiresThinkingAsText=settings.requiresThinkingAsText or False,
        requiresReasoningContentOnAssistantMessages=(
            settings.requiresReasoningContentOnAssistantMessages or False
        ),
        thinkingFormat=settings.thinkingFormat,
        chatTemplateKwargs=settings.chatTemplateKwargs,
        chatTemplateArgs=settings.chatTemplateArgs,
        openRouterRouting=settings.openRouterRouting,
        vercelGatewayRouting=settings.vercelGatewayRouting,
        zaiToolStream=settings.zaiToolStream,
        supportsStrictMode=settings.supportsStrictMode,
        cacheControlFormat=settings.cacheControlFormat,
        sendSessionAffinityHeaders=settings.sendSessionAffinityHeaders or False,
        sessionAffinityFormat=settings.sessionAffinityFormat,
        supportsLongCacheRetention=settings.supportsLongCacheRetention,
        supportsStore=settings.supportsStore,
        supportsOpenAIGrammarTools=settings.supportsOpenAIGrammarTools,
        supportsMidConvoSystemMessages=settings.supportsMidConvoSystemMessages,
        supportsMidConvoToolAdditions=settings.supportsMidConvoToolAdditions,
        thinkingTokenBudgetField=settings.thinkingTokenBudgetField,
        supportsThinkingTokenBudget=settings.supportsThinkingTokenBudget,
        vllmPriority=settings.vllmPriority,
    )
    return defaults


class _ToolCallBuilder:
    """A tool call assembled from argument fragments.

    ``arguments`` is the partially parsed object, refreshed from the whole accumulated
    fragment text on every delta, so a consumer reading it mid-stream sees what is
    parseable so far. Both it and the fragment text are scratch state.
    """

    def __init__(self, call_id: str, name: str, stream_index: int | None) -> None:
        self.block = ToolCall(id=call_id, name=name, arguments={})
        self.partial_args = ""
        self.stream_index = stream_index


def _request_headers(
    model: Model,
    options_headers: Mapping[str, str | None] | None,
    compat: OpenAICompletionsCompat,
    session_id: str | None,
) -> dict[str, str]:
    """The headers for one request: model headers, session affinity, then caller headers."""

    headers: dict[str, str] = {**(model.headers or {})}
    if session_id and compat.sendSessionAffinityHeaders:
        if compat.sessionAffinityFormat == "openrouter":
            headers["x-session-id"] = session_id
        else:
            if compat.sessionAffinityFormat == "openai":
                headers["session_id"] = session_id
            headers["x-client-request-id"] = session_id
            headers["x-session-affinity"] = session_id
    for key, value in (options_headers or {}).items():
        if value is not None:
            headers[key] = value
    return headers


def _build_request(
    model: Model,
    context: TranscriptContext,
    options: OpenAICompletionsOptions | None,
    compat: OpenAICompletionsCompat,
    cache_retention: CacheRetention,
) -> StreamRequest:
    """Assemble the request one completion sends."""

    normalized = resolve_transcript(context, compat.supportsMidConvoSystemMessages)
    grammar_properties = createGrammarToolInputProperties(
        _declared_tools(normalized),
        compat.supportsOpenAIGrammarTools is True,
    )
    body = buildParams(
        model,
        normalized,
        options,
        compat,
        cache_retention,
        grammar_properties,
    )
    session_id = None if cache_retention == "none" else (options.sessionId if options else None)
    headers = _request_headers(model, options.headers if options else None, compat, session_id)
    return StreamRequest(
        url=f"{model.baseUrl}/chat/completions",
        headers=headers,
        body=body,
        options=options,
    )


def _declared_tools(context: TranscriptContext) -> list[Any]:
    """Every tool the transcript declares, for the grammar-constraint lookup."""

    from app.ai.utils.transcript import get_declared_tools

    return get_declared_tools(context.messages)


def stream(
    model: Model,
    context: TranscriptContext,
    options: OpenAICompletionsOptions | None,
    chunk_stream: ChunkStreamFactory,
) -> AssistantMessageEventStream:
    """Stream one completion, returning the events as they arrive.

    The returned stream is populated asynchronously. A failure that happens before the first
    event terminates the stream with an error event rather than raising, because the caller
    has already been given the stream.
    """

    output = AssistantMessage(
        content=[],
        api=model.api,
        provider=model.provider,
        model=model.id,
        usage=_empty_usage(),
        stopReason=StopReason.PENDING,
        timestamp=int(time.time() * 1000),
    )
    event_stream = AssistantMessageEventStream()
    runner = asyncio.ensure_future(
        _run_stream(model, context, options, chunk_stream, output, event_stream),
    )
    # Kept referenced until it finishes so an unfinished runner is never collected.
    _RUNNERS.add(runner)
    runner.add_done_callback(_RUNNERS.discard)
    return event_stream


async def _run_stream(
    model: Model,
    context: TranscriptContext,
    options: OpenAICompletionsOptions | None,
    chunk_stream: ChunkStreamFactory,
    output: AssistantMessage,
    events: AssistantMessageEventStream,
) -> None:
    """Consume the chunk stream, emitting one event per change and settling at the end."""

    compat = resolve_compat(model)
    cache_retention = resolve_cache_retention(options)
    blocks = output.content
    text_block: TextContent | None = None
    thinking_block: ThinkingContent | None = None
    tool_calls_by_index: dict[int, _ToolCallBuilder] = {}
    tool_calls_by_id: dict[str, _ToolCallBuilder] = {}
    has_finish_reason = False

    def content_index(block: Any) -> int:
        return blocks.index(block)

    def ensure_text_block() -> TextContent:
        nonlocal text_block
        if text_block is None:
            text_block = TextContent(text="")
            blocks.append(text_block)
            events.push(EventTextStart(contentIndex=content_index(text_block), partial=output))
        return text_block

    def ensure_thinking_block(signature: str) -> ThinkingContent:
        nonlocal thinking_block
        if thinking_block is None:
            thinking_block = ThinkingContent(thinking="", thinkingSignature=signature or None)
            blocks.append(thinking_block)
            events.push(
                EventThinkingStart(contentIndex=content_index(thinking_block), partial=output),
            )
        return thinking_block

    def ensure_tool_call_block(delta: Mapping[str, Any]) -> _ToolCallBuilder:
        stream_index = delta.get("index")
        index = stream_index if isinstance(stream_index, int) else None
        function = delta.get("function")
        function_map = function if isinstance(function, Mapping) else {}
        name = function_map.get("name") or ""
        call_id = delta.get("id") or ""

        builder = tool_calls_by_index.get(index) if index is not None else None
        if builder is None and call_id:
            builder = tool_calls_by_id.get(str(call_id))
        if builder is None:
            builder = _ToolCallBuilder(call_id=str(call_id), name=str(name), stream_index=index)
            if index is not None:
                tool_calls_by_index[index] = builder
            if call_id:
                tool_calls_by_id[str(call_id)] = builder
            blocks.append(builder.block)
            events.push(
                EventToolCallStart(
                    contentIndex=content_index(builder.block),
                    partial=output,
                ),
            )
        # A fragment that only carries the stream position still has to register it, so the
        # next fragment for the same call finds this block.
        if index is not None:
            builder.stream_index = index
            tool_calls_by_index[index] = builder
        if call_id:
            tool_calls_by_id[str(call_id)] = builder
        if not builder.block.name and name:
            builder.block.name = str(name)
        return builder

    def finish_block(block: Any) -> None:
        """Emit the closing event for a block, finalizing a tool call's arguments."""

        index = content_index(block)
        if isinstance(block, TextContent):
            events.push(
                EventTextEnd(contentIndex=index, content=block.text, partial=output),
            )
        elif isinstance(block, ThinkingContent):
            events.push(
                EventThinkingEnd(contentIndex=index, content=block.thinking, partial=output),
            )
        elif isinstance(block, ToolCall):
            for builder in tool_calls_by_id.values():
                if builder.block is block:
                    block.arguments = parse_streaming_json(builder.partial_args)
                    break
            events.push(
                EventToolCallEnd(contentIndex=index, toolCall=block, partial=output),
            )

    try:
        request = _build_request(model, context, options, compat, cache_retention)
        if options is not None and options.onPayload is not None:
            replaced = options.onPayload(request.body, model)
            if isinstance(replaced, Awaitable):
                replaced = await replaced
            if replaced is not None:
                request.body = dict(replaced)
        opened = await retryProviderRequest(
            lambda: chunk_stream(request),
            ProviderRetryOptions(
                maxRetries=options.maxRetries if options else None,
                maxRetryDelayMs=options.maxRetryDelayMs if options else None,
                signal=options.signal if options else None,
            ),
        )
        if options is not None and options.onResponse is not None:
            handled = options.onResponse(opened.response, model)
            if handled is not None:
                await handled
        events.push(EventStart(partial=output))

        async for raw_chunk in opened.chunks:
            if not isinstance(raw_chunk, Mapping):
                continue
            chunk: Mapping[str, Any] = raw_chunk
            # Every chunk of one completion carries the same id, and a server may report the
            # concrete model it served, which can differ from the one requested.
            if not output.responseId and isinstance(chunk.get("id"), str):
                output.responseId = chunk["id"]
            served = chunk.get("model")
            if (
                not output.responseModel
                and isinstance(served, str)
                and served
                and served != model.id
            ):
                output.responseModel = served

            raw_usage = chunk.get("usage")
            if isinstance(raw_usage, Mapping):
                output.usage = parse_chunk_usage(raw_usage, model)

            choices = chunk.get("choices")
            choice = choices[0] if isinstance(choices, list) and choices else None
            if not isinstance(choice, Mapping):
                continue

            # Some servers report usage on the choice instead of the chunk.
            if not isinstance(raw_usage, Mapping) and isinstance(choice.get("usage"), Mapping):
                output.usage = parse_chunk_usage(choice["usage"], model)

            finish_reason = choice.get("finish_reason")
            if finish_reason is not None:
                output.rawStopReason = str(finish_reason)
                stop_reason, error_message = map_stop_reason(finish_reason)
                output.stopReason = stop_reason
                if error_message is not None:
                    output.errorMessage = error_message
                has_finish_reason = True

            delta = choice.get("delta")
            if not isinstance(delta, Mapping):
                continue

            content = delta.get("content")
            if isinstance(content, str) and content:
                text_target = ensure_text_block()
                text_target.text += content
                events.push(
                    EventTextDelta(
                        contentIndex=content_index(text_target),
                        delta=content,
                        partial=output,
                    ),
                )

            # The first non-empty reasoning field wins, so a server reporting the same text
            # under two names is not counted twice.
            reasoning_field = next(
                (
                    field
                    for field in REASONING_FIELDS
                    if isinstance(delta.get(field), str) and len(delta[field]) > 0
                ),
                None,
            )
            if reasoning_field is not None:
                reasoning_text = delta[reasoning_field]
                signature = (
                    "reasoning_content"
                    if model.provider == "opencode-go" and reasoning_field == "reasoning"
                    else reasoning_field
                )
                thinking_target = ensure_thinking_block(signature)
                thinking_target.thinking += reasoning_text
                events.push(
                    EventThinkingDelta(
                        contentIndex=content_index(thinking_target),
                        delta=reasoning_text,
                        partial=output,
                    ),
                )

            tool_call_deltas = delta.get("tool_calls")
            if isinstance(tool_call_deltas, list):
                for tool_call_delta in tool_call_deltas:
                    if not isinstance(tool_call_delta, Mapping):
                        continue
                    builder = ensure_tool_call_block(tool_call_delta)
                    if not builder.block.id and tool_call_delta.get("id"):
                        builder.block.id = str(tool_call_delta["id"])
                        tool_calls_by_id[builder.block.id] = builder

                    function = tool_call_delta.get("function")
                    function_map = function if isinstance(function, Mapping) else {}
                    fragment = ""
                    arguments = function_map.get("arguments")
                    if isinstance(arguments, str) and arguments:
                        fragment = arguments
                        builder.partial_args += arguments
                        builder.block.arguments = parse_streaming_json(builder.partial_args)
                    events.push(
                        EventToolCallDelta(
                            contentIndex=content_index(builder.block),
                            delta=fragment,
                            partial=output,
                        ),
                    )

        for block in list(blocks):
            finish_block(block)

        signal = options.signal if options else None
        if signal is not None and signal.aborted:
            raise RuntimeError("Request was aborted")
        if output.stopReason == StopReason.ABORTED:
            raise RuntimeError("Request was aborted")
        if not has_finish_reason and compat.supportsFinishReason is False:
            # The server never says why it stopped, so it is inferred from what arrived.
            used_tool = any(isinstance(block, ToolCall) for block in blocks)
            output.stopReason = StopReason.TOOL_USE if used_tool else StopReason.STOP
        if output.stopReason == StopReason.ERROR:
            raise RuntimeError(output.errorMessage or "Provider returned an error stop reason")
        if (compat.supportsFinishReason is not False and not has_finish_reason) or (
            output.stopReason == StopReason.PENDING
        ):
            raise RuntimeError("Stream ended without finish_reason")

        if output.stopReason not in (
            StopReason.STOP,
            StopReason.LENGTH,
            StopReason.TOOL_USE,
            StopReason.DEFERRED,
        ):
            raise RuntimeError(f"Unexpected terminal stop reason: {output.stopReason}")
        done_reason = cast(TerminalStopReason, str(output.stopReason))
        events.push(EventDone(reason=done_reason, message=output))
        events.end()
    except BaseException as error:
        signal = options.signal if options else None
        aborted = signal is not None and signal.aborted
        output.stopReason = StopReason.ABORTED if aborted else StopReason.ERROR
        output.errorMessage = formatProviderError(normalizeProviderError(error))
        raw_metadata = _raw_metadata(error)
        if raw_metadata and raw_metadata not in (output.errorMessage or ""):
            output.errorMessage = f"{output.errorMessage}\n{raw_metadata}"
        reason: ErrorStopReason = "aborted" if aborted else "error"
        events.push(EventError(reason=reason, error=output))
        events.end()


def _raw_metadata(error: BaseException) -> str | None:
    """Extra provider detail some gateways attach to a failure."""

    inner = getattr(error, "error", None)
    if not isinstance(inner, Mapping):
        return None
    metadata = inner.get("metadata")
    if not isinstance(metadata, Mapping):
        return None
    raw = metadata.get("raw")
    return str(raw) if raw is not None else None


def resolve_cache_retention(options: OpenAICompletionsOptions | None) -> CacheRetention:
    """The prompt-cache retention for this request, defaulting to the short one."""

    return resolveCacheRetention(
        options.cacheRetention if options else None,
        options.env if options else None,
    )


def stream_simple(
    model: Model,
    context: TranscriptContext,
    options: SimpleStreamOptions | None,
    chunk_stream: ChunkStreamFactory,
) -> AssistantMessageEventStream:
    """Stream with the simplified options, which add reasoning and tool choice."""

    base = build_base_options(
        model,
        context,
        options,
        options.apiKey if options else None,
    )
    clamped = clamp_reasoning(options.reasoning) if options and options.reasoning else None
    reasoning_effort = None if clamped == "off" else clamped
    shared = {field.name: getattr(base, field.name) for field in fields(StreamOptions)}
    merged = OpenAICompletionsOptions(
        **shared,
        toolChoice=options.toolChoice if options else None,
        reasoningEffort=reasoning_effort,
        thinkingBudgets=options.thinkingBudgets if options else None,
    )
    return stream(model, context, merged, chunk_stream)
