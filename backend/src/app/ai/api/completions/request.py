"""Encode replayable transcript records as Chat Completions request data."""

import json
import re

from app.ai.api.completions.response import valid_reasoning_detail
from app.ai.api.transform import transform_messages
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


def clean_text(value: str) -> str:
    """Remove lone surrogates while preserving valid pairs and Unicode code points."""
    return value.encode("utf-16-le", errors="surrogatepass").decode("utf-16-le", errors="ignore")


def image_part(block: ImageContent) -> dict[str, JSONValue]:
    """Encode an inline image without fetching external resources."""
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{block.mime_type};base64,{block.data}"},
    }


def build_request(model: Model, transcript: Transcript) -> dict[str, JSONValue]:
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
        or (isinstance(message, AssistantMessage)
        and any(isinstance(block, ToolCall) for block in message.content))
        for message in transcript.messages
    ):
        payload["tools"] = []
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


def short_hash(value: str) -> str:
    """Port pi's two unsigned 32-bit accumulators over JavaScript UTF-16 units."""
    mask = 0xFFFFFFFF
    h1, h2 = 0xDEADBEEF, 0x41C6CE57
    raw = value.encode("utf-16-le", errors="surrogatepass")
    for offset in range(0, len(raw), 2):
        char = int.from_bytes(raw[offset : offset + 2], "little")
        h1 = ((h1 ^ char) * 2654435761) & mask
        h2 = ((h2 ^ char) * 1597334677) & mask
    h1 = (((h1 ^ (h1 >> 16)) * 2246822507) ^ ((h2 ^ (h2 >> 13)) * 3266489909)) & mask
    h2 = (((h2 ^ (h2 >> 16)) * 2246822507) ^ ((h1 ^ (h1 >> 13)) * 3266489909)) & mask
    return base36(h2) + base36(h1)


def base36(value: int) -> str:
    """Format an unsigned integer with the radix used by the reference implementation."""
    result = ""
    while value:
        value, remainder = divmod(value, 36)
        result = "0123456789abcdefghijklmnopqrstuvwxyz"[remainder] + result
    return result or "0"


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
