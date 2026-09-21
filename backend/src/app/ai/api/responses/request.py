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
    ToolResultMessage,
    Transcript,
    UserMessage,
)
from app.ai.model import Model
from app.ai.transcript import (
    get_system_message_text,
    render_system_message_update,
    resolve_transcript,
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
    items: list[JSONValue] = []
    role = model.compat.system_role or (
        "developer"
        if model.capabilities.reasoning and model.compat.supports_developer_role is not False
        else "system"
    )
    message_index = 0
    for index, message in enumerate(history):
        if isinstance(message, SystemMessage):
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
    return {"model": model.id, "stream": True, "store": False, "input": items}


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
