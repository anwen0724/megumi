"""Making a transcript acceptable to the model about to receive it.

Two problems appear when a transcript is replayed to a provider. Content that only one
model can interpret has to be removed, and tool calls must be answered, because every
provider rejects an assistant turn whose tool call has no result. Both are handled here so
that no protocol adapter has to think about them.

Tool call identity needs the same treatment: an identifier one provider issued may be far
longer than another allows and may contain characters it forbids, so a caller can supply a
normalizer and every matching result is renamed with it.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence

from app.ai.types import (
    AssistantContent,
    AssistantMessage,
    ImageContent,
    Message,
    Model,
    StopReason,
    TextContent,
    ThinkingContent,
    ToolCall,
    ToolResultMessage,
    UserMessage,
)

__all__ = ["transform_messages"]

NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)"
NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)"

ToolCallIdNormalizer = Callable[[str, Model, AssistantMessage], str]


def _replace_images_with_placeholder(
    content: Sequence[TextContent | ImageContent],
    placeholder: str,
) -> list[TextContent | ImageContent]:
    """Replace every image with ``placeholder``, without repeating it for adjacent images."""

    result: list[TextContent | ImageContent] = []
    previous_was_placeholder = False

    for block in content:
        if isinstance(block, ImageContent):
            if not previous_was_placeholder:
                result.append(TextContent(text=placeholder))
            previous_was_placeholder = True
            continue

        result.append(block)
        previous_was_placeholder = block.text == placeholder

    return result


def _downgrade_unsupported_images(messages: Sequence[Message], model: Model) -> list[Message]:
    """Replace images with text for a model that cannot accept them."""

    if "image" in model.input:
        return list(messages)

    downgraded: list[Message] = []
    for message in messages:
        if isinstance(message, UserMessage) and isinstance(message.content, list):
            downgraded.append(
                UserMessage(
                    content=_replace_images_with_placeholder(
                        message.content,
                        NON_VISION_USER_IMAGE_PLACEHOLDER,
                    ),
                    timestamp=message.timestamp,
                ),
            )
            continue
        if isinstance(message, ToolResultMessage):
            downgraded.append(
                ToolResultMessage(
                    toolCallId=message.toolCallId,
                    toolName=message.toolName,
                    content=_replace_images_with_placeholder(
                        message.content,
                        NON_VISION_TOOL_IMAGE_PLACEHOLDER,
                    ),
                    isError=message.isError,
                    timestamp=message.timestamp,
                    details=message.details,
                    usage=message.usage,
                ),
            )
            continue
        downgraded.append(message)
    return downgraded


def _normalize_empty_content(messages: Sequence[Message]) -> list[Message]:
    """Give a message with no content an empty block list.

    Hand-built histories, custom tools and older session files can carry a message whose
    content is absent, and the rest of the layer relies on there always being a list.
    """

    normalized: list[Message] = []
    for message in messages:
        if getattr(message, "content", None) is None:
            if isinstance(message, UserMessage):
                normalized.append(UserMessage(content="", timestamp=message.timestamp))
                continue
            if isinstance(message, ToolResultMessage):
                normalized.append(
                    ToolResultMessage(
                        toolCallId=message.toolCallId,
                        toolName=message.toolName,
                        content=[],
                        isError=message.isError,
                        timestamp=message.timestamp,
                        details=message.details,
                        usage=message.usage,
                    ),
                )
                continue
            if isinstance(message, AssistantMessage):
                message.content = []
                normalized.append(message)
                continue
        normalized.append(message)
    return normalized


def _is_same_model(message: AssistantMessage, model: Model) -> bool:
    """Whether this response came from the model now being asked."""

    return (
        message.provider == model.provider
        and message.api == model.api
        and message.model == model.id
    )


def _transform_assistant_content(
    message: AssistantMessage,
    model: Model,
    is_same_model: bool,
    normalize_tool_call_id: ToolCallIdNormalizer | None,
    tool_call_id_map: dict[str, str],
) -> list[AssistantContent]:
    """Rewrite one assistant turn's blocks for the receiving model."""

    transformed: list[AssistantContent] = []
    for block in message.content:
        if isinstance(block, ThinkingContent):
            # Redacted thinking is opaque encrypted content that only its own model can
            # interpret, so it is dropped rather than replayed to a different one.
            if block.redacted:
                if is_same_model:
                    transformed.append(block)
                continue
            # A signature makes the block replayable even when its text is empty, which is
            # how encrypted reasoning arrives.
            if is_same_model and block.thinkingSignature:
                transformed.append(block)
                continue
            if not block.thinking or block.thinking.strip() == "":
                continue
            if is_same_model:
                transformed.append(block)
            else:
                transformed.append(TextContent(text=block.thinking))
            continue

        if isinstance(block, TextContent):
            transformed.append(block)
            continue

        if isinstance(block, ToolCall):
            normalized = block
            if not is_same_model and block.thoughtSignature is not None:
                normalized = ToolCall(
                    id=block.id,
                    name=block.name,
                    arguments=block.arguments,
                    thoughtSignature=None,
                    namespace=block.namespace,
                )
            if not is_same_model and normalize_tool_call_id is not None:
                normalized_id = normalize_tool_call_id(block.id, model, message)
                if normalized_id != block.id:
                    tool_call_id_map[block.id] = normalized_id
                    normalized = ToolCall(
                        id=normalized_id,
                        name=normalized.name,
                        arguments=normalized.arguments,
                        thoughtSignature=normalized.thoughtSignature,
                        namespace=normalized.namespace,
                    )
            transformed.append(normalized)
            continue

    return transformed


def _copy_assistant_with_content(
    message: AssistantMessage,
    content: list[AssistantContent],
) -> AssistantMessage:
    """Rebuild an assistant message around rewritten content."""

    copied = AssistantMessage(
        content=content,
        api=message.api,
        provider=message.provider,
        model=message.model,
        usage=message.usage,
        stopReason=message.stopReason,
        timestamp=message.timestamp,
        responseModel=message.responseModel,
        responseId=message.responseId,
        providerThinkingLevel=message.providerThinkingLevel,
        diagnostics=message.diagnostics,
        deferred=message.deferred,
        errorMessage=message.errorMessage,
        rawStopReason=message.rawStopReason,
        endTurn=message.endTurn,
    )
    return copied


def transform_messages(
    messages: Sequence[Message],
    model: Model,
    normalize_tool_call_id: ToolCallIdNormalizer | None = None,
) -> list[Message]:
    """Prepare a transcript for ``model``.

    Responses from another model lose the content only their model can interpret, and every
    tool call is answered: an unresolved call gets a synthetic error result, because a
    provider rejects a transcript where one is missing.
    """

    tool_call_id_map: dict[str, str] = {}
    normalized = _normalize_empty_content(messages)
    image_aware = _downgrade_unsupported_images(normalized, model)

    transformed: list[Message] = []
    for message in image_aware:
        if isinstance(message, UserMessage):
            transformed.append(message)
            continue

        if isinstance(message, ToolResultMessage):
            normalized_id = tool_call_id_map.get(message.toolCallId)
            if normalized_id and normalized_id != message.toolCallId:
                transformed.append(
                    ToolResultMessage(
                        toolCallId=normalized_id,
                        toolName=message.toolName,
                        content=message.content,
                        isError=message.isError,
                        timestamp=message.timestamp,
                        details=message.details,
                        usage=message.usage,
                    ),
                )
                continue
            transformed.append(message)
            continue

        if isinstance(message, AssistantMessage):
            same_model = _is_same_model(message, model)
            content = _transform_assistant_content(
                message,
                model,
                same_model,
                normalize_tool_call_id,
                tool_call_id_map,
            )
            transformed.append(_copy_assistant_with_content(message, content))
            continue

        transformed.append(message)

    # A system message between a tool call and its result is held back until the results
    # are settled, including the synthetic ones, so it cannot split the pair.
    result: list[Message] = []
    pending_tool_calls: list[ToolCall] = []
    existing_tool_result_ids: set[str] = set()
    held_system_messages: list[Message] = []

    def close_pending_tool_calls() -> None:
        """Answer every unresolved tool call, then release the held system messages."""

        nonlocal pending_tool_calls, existing_tool_result_ids
        if pending_tool_calls:
            for call in pending_tool_calls:
                if call.id not in existing_tool_result_ids:
                    result.append(
                        ToolResultMessage(
                            toolCallId=call.id,
                            toolName=call.name,
                            content=[TextContent(text="No result provided")],
                            isError=True,
                            timestamp=int(time.time() * 1000),
                        ),
                    )
            pending_tool_calls = []
            existing_tool_result_ids = set()
        result.extend(held_system_messages)
        held_system_messages.clear()

    for message in transformed:
        if isinstance(message, AssistantMessage):
            close_pending_tool_calls()
            # An incomplete turn is not replayed: it can hold reasoning with no message or
            # a tool call with no result, and the model should retry from the last valid
            # state instead.
            if message.stopReason in (StopReason.ERROR, StopReason.ABORTED):
                continue
            tool_calls = [block for block in message.content if isinstance(block, ToolCall)]
            if tool_calls:
                pending_tool_calls = tool_calls
                existing_tool_result_ids = set()
            result.append(message)
            continue

        if isinstance(message, ToolResultMessage):
            existing_tool_result_ids.add(message.toolCallId)
            result.append(message)
            continue

        if getattr(message, "role", None) == "system":
            if pending_tool_calls:
                held_system_messages.append(message)
            else:
                result.append(message)
            continue

        if isinstance(message, UserMessage):
            # A new user turn ends the tool flow, so anything still open is answered here.
            close_pending_tool_calls()
            result.append(message)
            continue

        result.append(message)

    close_pending_tool_calls()
    return result
