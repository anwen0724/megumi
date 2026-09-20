"""Prepare independent outbound history without executing tools or changing storage."""

import time
from collections.abc import Callable, Sequence
from copy import deepcopy

from app.ai.messages import (
    AssistantContent,
    AssistantMessage,
    ImageContent,
    InputContent,
    Message,
    SystemMessage,
    TextContent,
    ThinkingContent,
    ToolCall,
    ToolResultMessage,
    UserMessage,
)
from app.ai.model import Model


def transform_messages(
    messages: Sequence[Message],
    model: Model,
    normalize_tool_call_id: Callable[[str, Model, AssistantMessage], str] | None = None,
) -> list[Message]:
    """Move system changes after tool results and repair unfinished successful turns."""
    result: list[Message] = []
    held: list[Message] = []
    pending: list[ToolCall] = []
    answered: set[str] = set()

    def close_pending() -> None:
        """Close one assistant's tool flow before a new turn, then flush instructions."""
        for call in pending:
            if call.id not in answered:
                result.append(
                    ToolResultMessage(
                        tool_call_id=call.id,
                        tool_name=call.name,
                        content=[TextContent(text="No result provided")],
                        is_error=True,
                        timestamp=time.time_ns() // 1_000_000,
                    )
                )
        pending.clear()
        answered.clear()
        result.extend(held)
        held.clear()

    for message in _transform_content(messages, model, normalize_tool_call_id):
        if isinstance(message, AssistantMessage):
            close_pending()
            if message.stop_reason in ("error", "aborted"):
                continue
            pending.extend(c for c in message.content if isinstance(c, ToolCall))
        elif isinstance(message, UserMessage):
            close_pending()
        elif isinstance(message, ToolResultMessage):
            answered.add(message.tool_call_id)
        elif isinstance(message, SystemMessage) and pending:
            held.append(message)
            continue
        result.append(message)
    close_pending()
    return result


def _transform_content(
    messages: Sequence[Message],
    model: Model,
    normalize_tool_call_id: Callable[[str, Model, AssistantMessage], str] | None,
) -> list[Message]:
    """Keep source-specific reasoning only for the exact same model identity."""
    prepared = deepcopy(list(messages))
    id_map: dict[str, str] = {}
    for message in prepared:
        if getattr(message, "content", None) is None:
            message.content = []  # Normalize untyped caller input, as pi does.
        if "image" not in model.capabilities.input_modalities:
            if isinstance(message, UserMessage) and isinstance(message.content, list):
                message.content = _replace_images(
                    message.content, "(image omitted: model does not support images)"
                )
            elif isinstance(message, ToolResultMessage):
                message.content = _replace_images(
                    message.content, "(tool image omitted: model does not support images)"
                )
        if isinstance(message, ToolResultMessage):
            message.tool_call_id = id_map.get(message.tool_call_id, message.tool_call_id)
        if not isinstance(message, AssistantMessage):
            continue
        same = (message.provider, message.api, message.model) == (
            model.provider,
            model.api,
            model.id,
        )
        original_source = deepcopy(message)
        content: list[AssistantContent] = []
        for block in message.content:
            if isinstance(block, ThinkingContent):
                if block.redacted:
                    if same:
                        content.append(block)
                elif same and block.thinking_signature:
                    content.append(block)
                elif block.thinking.strip():
                    content.append(block if same else TextContent(text=block.thinking))
            elif isinstance(block, TextContent) and not same:
                content.append(TextContent(text=block.text))
            elif isinstance(block, ToolCall) and not same:
                if block.thought_signature:
                    block.thought_signature = None
                if normalize_tool_call_id:
                    # Supply the source identity before rewriting its call ID.
                    original = block.id
                    normalized = normalize_tool_call_id(original, model, deepcopy(original_source))
                    if normalized != original:
                        id_map[original] = normalized
                        block.id = normalized
                content.append(block)
            else:
                content.append(block)
        message.content = content
    return prepared


def _replace_images(content: Sequence[InputContent], placeholder: str) -> list[InputContent]:
    """Collapse adjacent unavailable images, including an existing identical placeholder."""
    result: list[InputContent] = []
    previous_placeholder = False
    for block in content:
        if isinstance(block, ImageContent):
            if not previous_placeholder:
                result.append(TextContent(text=placeholder))
            previous_placeholder = True
        else:
            result.append(block)
            previous_placeholder = block.text == placeholder
    return result
