"""Normalize context and replay ordered system/tool changes for protocol requests."""

import json
from collections.abc import Sequence
from copy import deepcopy
from dataclasses import asdict, dataclass

from app.ai.messages import Context, Message, SystemMessage, TextContent, Tool, Transcript


def normalize_context(context: Context) -> Transcript:
    """Produce a normalized transcript without changing caller history."""
    messages = deepcopy(context.messages)
    if context.system_prompt or context.tools:
        messages.insert(
            0,
            SystemMessage(
                content=context.system_prompt or "",
                timestamp=0,
                tools_added=deepcopy(context.tools) or None,
            ),
        )
    return Transcript(messages=messages)


def get_current_system_message(messages: Sequence[Message]) -> SystemMessage | None:
    """Replay prompt patches, keeping the first system timestamp even after replacement."""
    text: list[str] = []
    sections: dict[str, str | None] = {}
    timestamp: int | None = None
    for message in messages:
        if not isinstance(message, SystemMessage):
            continue
        if timestamp is None:
            timestamp = message.timestamp
        if message.replace:
            text.clear()
            sections.clear()
        rendered = content_text(message.content)
        if rendered:
            text.append(rendered)
        for name, value in (message.sections or {}).items():
            if value is None:
                sections.pop(name, None)
            else:
                sections[name] = value
    if timestamp is None:
        return None
    return SystemMessage(
        content="\n\n".join(text),
        sections=sections or None,
        timestamp=timestamp,
        tools_added=get_current_tools(messages) or None,
    )


def get_system_message_text(message: SystemMessage) -> str:
    """Render a complete prompt, following section insertion order."""
    return "\n\n".join(
        part for part in [content_text(message.content), *(message.sections or {}).values()] if part
    )


def get_current_system_prompt(messages: Sequence[Message]) -> str:
    """Render the prompt obtained by replaying all system changes."""
    current = get_current_system_message(messages)
    return get_system_message_text(current) if current else ""


def render_system_message_update(message: SystemMessage) -> str:
    """Explain named section updates when system messages remain in place."""
    rendered = content_text(message.content)
    parts = [rendered] if rendered else []
    for name, value in (message.sections or {}).items():
        parts.append(
            f'Removed system prompt section "{name}".'
            if value is None
            else f'Updated system prompt section "{name}":\n\n{value}'
        )
    return "\n\n".join(parts)


def get_current_tools(messages: Sequence[Message]) -> list[Tool]:
    """Apply removals before additions; replacement clears prior declarations."""
    tools: dict[str, Tool] = {}
    for message in messages:
        if not isinstance(message, SystemMessage):
            continue
        if message.replace:
            tools.clear()
        for name in message.tools_removed or []:
            tools.pop(name, None)
        for tool in message.tools_added or []:
            tools[tool.name] = tool
    return deepcopy(list(tools.values()))


@dataclass
class TranscriptTools:
    """Top-level declarations and whether later additions retain their positions."""

    request_tools: list[Tool]
    anchors_additions: bool


def get_initial_system_message(messages: Sequence[Message]) -> SystemMessage | None:
    """Return only a leading system message, not a later instruction."""
    return messages[0] if messages and isinstance(messages[0], SystemMessage) else None


def without_initial_system_message(messages: Sequence[Message]) -> list[Message]:
    """Return history after its optional leading system record."""
    return list(messages[1:] if get_initial_system_message(messages) else messages)


def resolve_transcript(
    context: Transcript, supports_mid_convo_system_messages: bool | None
) -> Transcript:
    """Collapse later replacements even when mid-conversation instructions are supported."""
    late_replace = any(isinstance(m, SystemMessage) and m.replace for m in context.messages[1:])
    if supports_mid_convo_system_messages and not late_replace:
        return deepcopy(context)
    head = get_current_system_message(context.messages)
    rest = [m for m in context.messages if not isinstance(m, SystemMessage)]
    return Transcript(messages=deepcopy(([head] if head else []) + rest))


def has_non_additive_tool_changes(messages: Sequence[Message]) -> bool:
    """Same-name redeclaration, including an identical one, is not a pure addition."""
    names: set[str] = set()
    for message in messages:
        if not isinstance(message, SystemMessage):
            continue
        if message.tools_removed:
            return True
        for tool in message.tools_added or []:
            if tool.name in names:
                return True
            names.add(tool.name)
    return False


def resolve_transcript_tools(
    messages: Sequence[Message], supports_tool_additions: bool
) -> TranscriptTools:
    """Choose initial tools plus anchored additions, or the final tool set."""
    anchors = supports_tool_additions and not has_non_additive_tool_changes(messages)
    initial = get_initial_system_message(messages)
    request = (initial.tools_added or []) if anchors and initial else []
    if not anchors:
        request = get_current_tools(messages)
    return TranscriptTools(deepcopy(request), anchors)


def to_tool_declaration(tool: Tool) -> Tool:
    """Copy declared fields only; execution/display attributes never reach requests."""
    return Tool(
        name=tool.name,
        description=tool.description,
        parameters=deepcopy(tool.parameters),
        constrained_sampling=deepcopy(tool.constrained_sampling),
    )


def declarations_equal(left: Tool, right: Tool) -> bool:
    """Compare serialized declarations, including schema insertion order."""
    return json.dumps(asdict(to_tool_declaration(left)), ensure_ascii=False) == json.dumps(
        asdict(to_tool_declaration(right)), ensure_ascii=False
    )


@dataclass
class ToolStateChanges:
    """A changed declaration is a removal followed by an addition."""

    tools_added: list[Tool]
    tools_removed: list[str]


def get_tool_state_changes(previous: Sequence[Tool], current: Sequence[Tool]) -> ToolStateChanges:
    """Describe how to replace one complete declaration set with another."""
    before = {t.name: t for t in previous}
    after = {t.name: t for t in current}
    return ToolStateChanges(
        [
            to_tool_declaration(t)
            for t in current
            if t.name not in before or not declarations_equal(before[t.name], t)
        ],
        [
            t.name
            for t in previous
            if t.name not in after or not declarations_equal(t, after[t.name])
        ],
    )


def content_text(content: str | Sequence[TextContent], separator: str = "\n") -> str:
    """Render text blocks without changing their stored representation."""
    return content if isinstance(content, str) else separator.join(block.text for block in content)
