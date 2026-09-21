"""Encode replayable transcript records as Chat Completions request data."""

import json
import re

from app.ai.api.completions.options import CompletionsOptions
from app.ai.api.completions.response import valid_reasoning_detail
from app.ai.api.transform import clean_text, short_hash, transform_messages
from app.ai.messages import (
    AssistantMessage,
    ImageContent,
    JSONValue,
    SystemMessage,
    TextContent,
    ThinkingContent,
    ToolCall,
    ToolDefinition,
    ToolResultMessage,
    Transcript,
    UserMessage,
)
from app.ai.model import Model
from app.ai.tools.schema import make_strict_json_schema, resolve_json_schema_strict_sampling
from app.ai.transcript import (
    get_system_message_text,
    render_system_message_update,
    resolve_transcript,
    resolve_transcript_tools,
)


def image_part(block: ImageContent) -> dict[str, JSONValue]:
    """Encode an inline image without fetching external resources."""
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{block.mime_type};base64,{block.data}"},
    }


def build_request(
    model: Model, transcript: Transcript, options: CompletionsOptions
) -> dict[str, JSONValue]:
    """Resolve transcript updates before encoding an independent outbound history."""
    resolved = resolve_transcript(transcript, model.compat.supports_mid_convo_system_messages)
    history = transform_messages(
        resolved.messages, model, lambda value, target, _: normalize_call_id(value, target)
    )
    tools = resolve_transcript_tools(
        resolved.messages,
        bool(
            model.compat.supports_mid_convo_system_messages
            and model.compat.supports_mid_convo_tool_additions
        ),
    )
    messages: list[JSONValue] = []
    role = model.compat.system_role or (
        "developer"
        if model.capabilities.reasoning and model.compat.supports_developer_role is not False
        else "system"
    )
    tool_images: list[JSONValue] = []
    for index, message in enumerate(history):
        if isinstance(message, SystemMessage):
            if index > 0 and tools.anchors_additions and message.tools_added:
                messages.append(
                    {
                        "role": "system",
                        "tools": [encode_tool(tool, model) for tool in message.tools_added],
                    }
                )
            text = (
                get_system_message_text(message)
                if index == 0
                else render_system_message_update(message)
            )
            if text:
                messages.append({"role": role, "content": clean_text(text)})
        elif isinstance(message, UserMessage):
            if isinstance(message.content, str):
                messages.append({"role": "user", "content": clean_text(message.content)})
            elif message.content:
                messages.append(
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": clean_text(block.text)}
                            if isinstance(block, TextContent)
                            else image_part(block)
                            for block in message.content
                        ],
                    }
                )
        elif isinstance(message, AssistantMessage):
            encoded = encode_assistant(message)
            if encoded is not None:
                if (
                    model.capabilities.reasoning
                    and model.compat.requires_reasoning_content_on_assistant_messages
                ):
                    encoded.setdefault("reasoning_content", "")
                messages.append(encoded)
        elif isinstance(message, ToolResultMessage):
            text = "\n".join(b.text for b in message.content if isinstance(b, TextContent))
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": message.tool_call_id,
                    "content": clean_text(
                        text
                        or (
                            "(see attached image)"
                            if any(isinstance(b, ImageContent) for b in message.content)
                            else "(no tool output)"
                        )
                    ),
                }
            )
            tool_images.extend(
                image_part(b) for b in message.content if isinstance(b, ImageContent)
            )
            if tool_images and (
                index + 1 == len(history) or not isinstance(history[index + 1], ToolResultMessage)
            ):
                messages.append(
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Attached image(s) from tool result:"},
                            *tool_images,
                        ],
                    }
                )
                tool_images = []
    payload: dict[str, JSONValue] = {"model": model.id, "stream": True, "messages": messages}
    if tools.request_tools:
        payload["tools"] = [encode_tool(tool, model) for tool in tools.request_tools]
    elif any(
        isinstance(message, ToolResultMessage)
        or (
            isinstance(message, AssistantMessage)
            and any(isinstance(block, ToolCall) for block in message.content)
        )
        for message in transcript.messages
    ):
        payload["tools"] = []
    if model.compat.supports_usage_in_streaming is not False:
        payload["stream_options"] = {"include_usage": True}
    if model.compat.supports_store:
        payload["store"] = False
    if options.max_output_tokens is not None:
        payload[model.compat.max_tokens_field or "max_completion_tokens"] = (
            options.max_output_tokens
        )
    if options.tool_choice is not None:
        payload["tool_choice"] = options.tool_choice
    effort = options.reasoning_effort
    mapping = model.capabilities.reasoning_levels
    if model.capabilities.reasoning:
        if model.compat.thinking_format == "deepseek":
            if effort:
                payload["thinking"] = {"type": "enabled"}
            elif "off" not in mapping or mapping["off"] is not None:
                payload["thinking"] = {"type": "disabled"}
        if model.compat.supports_reasoning_effort:
            mapped = mapping.get(effort, effort) if effort else mapping.get("off")
            if isinstance(mapped, str) and (effort or model.compat.thinking_format != "deepseek"):
                payload["reasoning_effort"] = mapped
    if options.thinking is not None:
        payload["thinking"] = options.thinking
    thinking = payload.get("thinking")
    thinking_on = (
        thinking.get("type") != "disabled"
        if isinstance(thinking, dict)
        else bool(effort) or mapping.get("off", "off") is None
    )
    if options.temperature is not None and not (
        model.compat.temperature_requires_reasoning_off
        and model.capabilities.reasoning
        and thinking_on
    ):
        payload["temperature"] = options.temperature
    long_cache = options.cache_retention == "long" and model.compat.supports_long_cache_retention
    if long_cache:
        payload["prompt_cache_retention"] = "24h"
    if options.session_id and (
        long_cache
        or (options.cache_retention != "none" and "api.openai.com" in (model.base_url or ""))
    ):
        payload["prompt_cache_key"] = clean_text(options.session_id)[:64]
    payload.update(options.sampling_params or {})
    return payload


def encode_assistant(message: AssistantMessage) -> dict[str, JSONValue] | None:
    """Replay text, signed reasoning and calls without changing stored messages."""
    text = "".join(
        clean_text(b.text) for b in message.content if isinstance(b, TextContent) and b.text.strip()
    )
    result: dict[str, JSONValue] = {"role": "assistant", "content": text or None}
    details = reasoning_details(message)
    if details:
        result["reasoning_details"] = details
    thinking = [b for b in message.content if isinstance(b, ThinkingContent) and b.thinking.strip()]
    if (
        not details
        and thinking
        and thinking[0].thinking_signature in {"reasoning_content", "reasoning", "reasoning_text"}
    ):
        result[thinking[0].thinking_signature] = "\n".join(b.thinking for b in thinking)
    calls: list[JSONValue] = [
        {
            "id": b.id,
            "type": "function",
            "function": {
                "name": b.name,
                "arguments": json.dumps(b.arguments, ensure_ascii=False, separators=(",", ":")),
            },
        }
        for b in message.content
        if isinstance(b, ToolCall)
    ]
    if calls:
        result["tool_calls"] = calls
    return result if text or calls else None


def normalize_call_id(value: str, model: Model) -> str:
    """Match pi's Responses item identity conversion and 40-character prefix/hash rule."""
    if "|" not in value:
        return value[:40] if model.provider == "openai" else value
    call, item = (re.sub(r"[^a-zA-Z0-9_-]", "_", part) for part in value.split("|", 1))
    combined = f"{call}_{item}" if item else call
    if len(combined) <= 40:
        return combined
    digest = short_hash(value)[:8]
    return f"{call[: max(1, 39 - len(digest))]}_{digest}"


def reasoning_details(message: AssistantMessage) -> list[JSONValue] | None:
    """Prefer a complete thinking signature, falling back to legacy encrypted tool records."""
    legacy: list[JSONValue] = []
    for block in message.content:
        signature = (
            block.thinking_signature
            if isinstance(block, ThinkingContent)
            else block.thought_signature
            if isinstance(block, ToolCall)
            else None
        )
        if not signature:
            continue
        try:
            value: JSONValue = json.loads(signature)
        except ValueError:
            continue
        if (
            isinstance(block, ThinkingContent)
            and isinstance(value, list)
            and value
            and all(valid_reasoning_detail(item) for item in value)
        ):
            return value
        if (
            isinstance(block, ToolCall)
            and isinstance(value, dict)
            and valid_reasoning_detail(value)
            and value.get("type") == "reasoning.encrypted"
            and value.get("id")
            and value.get("data")
        ):
            legacy.append(value)
    return legacy or None


def encode_tool(tool: ToolDefinition, model: Model) -> dict[str, JSONValue]:
    """Resolve strict policy using the shared converter, without validating generated arguments."""
    supported = model.compat.supports_strict_mode is not False
    strict = resolve_json_schema_strict_sampling(tool, supported)
    function: dict[str, JSONValue] = {
        "name": tool.name,
        "description": tool.description,
        "parameters": make_strict_json_schema(tool.parameters) if strict else tool.parameters,
    }
    if supported:
        function["strict"] = strict or False
    return {"type": "function", "function": function}
