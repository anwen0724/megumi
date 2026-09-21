"""Encode stateless conversation items for the Responses SDK."""

import json
import re

from app.ai.api.responses.options import ResponsesOptions
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
    """Encode inline image input without external retrieval."""
    return {
        "type": "input_image",
        "image_url": f"data:{block.mime_type};base64,{block.data}",
        "detail": "auto",
    }


def build_request(
    model: Model, transcript: Transcript, options: ResponsesOptions
) -> dict[str, JSONValue]:
    """Resolve instruction updates and encode independent full history."""
    resolved = resolve_transcript(transcript, model.compat.supports_mid_convo_system_messages)
    history = transform_messages(resolved.messages, model, normalize_call_id)
    tools = resolve_transcript_tools(
        resolved.messages,
        bool(model.compat.supports_additional_tools or model.compat.supports_tool_search),
    )
    items: list[JSONValue] = []
    role = model.compat.system_role or (
        "developer"
        if model.capabilities.reasoning and model.compat.supports_developer_role is not False
        else "system"
    )
    message_index = 0
    for index, message in enumerate(history):
        if isinstance(message, SystemMessage):
            if index > 0 and tools.anchors_additions and message.tools_added:
                items.extend(encode_tool_additions(message.tools_added, model, message_index))
            text = (
                get_system_message_text(message)
                if index == 0
                else render_system_message_update(message)
            )
            if text:
                items.append({"role": role, "content": clean_text(text)})
        elif isinstance(message, UserMessage):
            if isinstance(message.content, str):
                content: list[JSONValue] = [
                    {"type": "input_text", "text": clean_text(message.content)}
                ]
            else:
                content = [
                    {"type": "input_text", "text": clean_text(block.text)}
                    if isinstance(block, TextContent)
                    else image_part(block)
                    for block in message.content
                ]
            if content:
                items.append({"role": "user", "content": content})
        elif isinstance(message, AssistantMessage):
            items.extend(encode_assistant(message, message_index, model))
        elif isinstance(message, ToolResultMessage):
            text = clean_text(
                "\n".join(b.text for b in message.content if isinstance(b, TextContent))
            )
            images: list[JSONValue] = [
                image_part(b) for b in message.content if isinstance(b, ImageContent)
            ]
            if images:
                output_parts: list[JSONValue] = (
                    [{"type": "input_text", "text": text}] if text else []
                )
                output_parts.extend(images)
                output: JSONValue = output_parts
            else:
                output = text or "(no tool output)"
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": message.tool_call_id.split("|", 1)[0],
                    "output": output,
                }
            )
        if not (index == 0 and isinstance(message, SystemMessage)):
            message_index += 1
    payload: dict[str, JSONValue] = {
        "model": model.id,
        "stream": True,
        "store": False,
        "input": items,
    }
    if tools.request_tools:
        payload["tools"] = [encode_tool(tool, model) for tool in tools.request_tools]
    return payload


def parse_text_signature(signature: str | None) -> tuple[str | None, str | None]:
    """Read versioned text identity, retaining legacy raw item IDs."""
    if not signature:
        return None, None
    try:
        value = json.loads(signature)
        if isinstance(value, dict) and value.get("v") == 1 and isinstance(value.get("id"), str):
            phase = value.get("phase")
            return value["id"], phase if phase in ("commentary", "final_answer") else None
    except ValueError:
        pass
    return signature, None


def encode_assistant(
    message: AssistantMessage, message_index: int, model: Model
) -> list[JSONValue]:
    """Replay native reasoning and separately identifiable assistant text items."""
    items: list[JSONValue] = []
    text_index = 0
    for block in message.content:
        if isinstance(block, ThinkingContent):
            if block.thinking_signature:
                items.append(json.loads(block.thinking_signature))
        elif isinstance(block, TextContent):
            identity, phase = parse_text_signature(block.text_signature)
            identity = identity or f"msg_pi_{message_index}" + (
                f"_{text_index}" if text_index else ""
            )
            if len(identity) > 64:
                identity = f"msg_{short_hash(identity)}"
            item: dict[str, JSONValue] = {
                "type": "message",
                "role": "assistant",
                "id": identity,
                "status": "completed",
                "content": [
                    {"type": "output_text", "text": clean_text(block.text), "annotations": []}
                ],
            }
            if phase:
                item["phase"] = phase
            items.append(item)
            text_index += 1
        elif isinstance(block, ToolCall):
            call_id, _, item_id = block.id.partition("|")
            same_api = (message.provider, message.api) == (model.provider, model.api)
            same_model = same_api and message.model == model.id
            tool: dict[str, JSONValue] = {
                "type": "function_call",
                "call_id": call_id,
                "name": block.name,
                "arguments": json.dumps(block.arguments, ensure_ascii=False, separators=(",", ":")),
            }
            if item_id.startswith("fc_") and not (same_api and not same_model):
                tool["id"] = item_id
            if same_model and block.namespace:
                tool["namespace"] = block.namespace
            items.append(tool)
    return items


def normalize_call_id(value: str, target: Model, source: AssistantMessage) -> str:
    """Normalize cross-source IDs while retaining separate OpenAI call/item identities."""

    def part(raw: str) -> str:
        return re.sub(r"[^a-zA-Z0-9_-]", "_", raw)[:64].rstrip("_")

    if target.provider not in {"openai", "openai-codex", "opencode"} or "|" not in value:
        return part(value)
    call, item = value.split("|", 1)
    foreign = (source.provider, source.api) != (target.provider, target.api)
    item = f"fc_{short_hash(item)}" if foreign else part(item)
    if not item.startswith("fc_"):
        item = f"fc_{item}"
    return f"{part(call)}|{part(item)}"


def encode_tool(tool: ToolDefinition, model: Model) -> dict[str, JSONValue]:
    """Convert function declarations using the shared strict-schema policy."""
    supported = model.compat.supports_strict_mode is True
    strict = resolve_json_schema_strict_sampling(tool, supported)
    result: dict[str, JSONValue] = {
        "type": "function",
        "name": tool.name,
        "description": tool.description,
        "parameters": make_strict_json_schema(tool.parameters) if strict else tool.parameters,
    }
    if supported:
        result["strict"] = strict or False
    return result


def encode_tool_additions(
    tools: list[ToolDefinition], model: Model, message_index: int
) -> list[JSONValue]:
    """Represent already-known client declarations, without executing a search."""
    encoded: list[JSONValue] = [encode_tool(tool, model) for tool in tools]
    if model.compat.supports_additional_tools:
        return [{"type": "additional_tools", "role": "developer", "tools": encoded}]
    names = [tool.name for tool in tools]
    call_id = "pi_tool_load_" + short_hash(f"system:{message_index}:" + ",".join(names))
    deferred: list[JSONValue] = [
        {**encode_tool(tool, model), "defer_loading": True} for tool in tools
    ]
    return [
        {
            "type": "tool_search_call",
            "call_id": call_id,
            "execution": "client",
            "status": "completed",
            "arguments": {"query": " ".join(names), "limit": len(names)},
        },
        {
            "type": "tool_search_output",
            "call_id": call_id,
            "execution": "client",
            "status": "completed",
            "tools": deferred,
        },
    ]
