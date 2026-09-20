"""Content-block text extraction.

Message content is either a plain string or a list of blocks. Only text blocks carry
text; the other block kinds are dropped rather than rendered, because a caller asking for
text wants the model-visible prompt, not a transcript.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.ai.types import (
    ImagesInputContent,
    SystemMessage,
    TextContent,
    ThinkingContent,
    ToolCall,
)

__all__ = ["contentText", "getSystemMessageText", "renderSystemMessageUpdate"]

Content = TextContent | ThinkingContent | ToolCall | ImagesInputContent


def contentText(content: str | Sequence[Content], separator: str = "\n") -> str:
    """Extract and join the text of ``content``.

    Only text blocks contribute; the other block kinds are skipped rather than rendered,
    because a caller asking for text wants the model-visible prompt.
    """

    if isinstance(content, str):
        return content
    return separator.join(block.text for block in content if isinstance(block, TextContent))


def getSystemMessageText(message: SystemMessage) -> str:
    """Render a system message as a complete prompt: its content followed by its sections.

    Empty parts are dropped so that a message without sections does not gain a trailing
    separator.
    """

    parts = [contentText(message.content)]
    for text in (message.sections or {}).values():
        if text is not None:
            parts.append(text)
    return "\n\n".join(part for part in parts if len(part) > 0)


def renderSystemMessageUpdate(message: SystemMessage) -> str:
    """Render a later system message for APIs that accept mid-conversation system messages.

    Section changes are framed by name so the model can relate them to the leading prompt.
    This framing is request-time only and may change between versions.
    """

    parts: list[str] = []
    text = contentText(message.content)
    if len(text) > 0:
        parts.append(text)
    for name, value in (message.sections or {}).items():
        parts.append(
            f'Removed system prompt section "{name}".'
            if value is None
            else f'Updated system prompt section "{name}":\n\n{value}'
        )
    return "\n\n".join(parts)
