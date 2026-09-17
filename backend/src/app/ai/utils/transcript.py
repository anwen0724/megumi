"""Replaying a transcript's system messages into the prompt and tools in effect now.

The prompt and the tool set are not fixed at the start of a conversation. A later system
message can add instructions, patch a named prompt section, remove a section, or replace
the whole baseline; tools can be added and removed the same way. Replaying every system
message in order therefore yields the current state, which is what a provider adapter
needs, because most transports cannot retract a prompt they already received.

:func:`normalize_context` is the only entry point that produces a
:class:`~app.ai.types.TranscriptContext`. Provider-facing functions take that type, so a
caller's raw :class:`~app.ai.types.Context` cannot reach an adapter without having been
folded into a leading system message first.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict
from typing import Any

from app.ai.types import (
    Context,
    Message,
    SystemMessage,
    Tool,
    ToolReference,
    TranscriptContext,
)
from app.ai.utils.text import contentText, getSystemMessageText

__all__ = [
    "ToolStateChanges",
    "TranscriptContext",
    "TranscriptTools",
    "collapse_system_messages",
    "create_initial_system_message",
    "declarations_equal",
    "get_current_system_message",
    "get_current_system_prompt",
    "get_current_tools",
    "get_declared_tools",
    "get_initial_system_message",
    "get_tool_state_changes",
    "has_non_additive_tool_changes",
    "has_tool_redefinitions",
    "normalize_context",
    "resolve_transcript",
    "resolve_transcript_tools",
    "to_tool_declaration",
    "without_initial_system_message",
]


def create_initial_system_message(
    system_prompt: str | None,
    tools: Sequence[Tool] | None,
) -> SystemMessage | None:
    """Build the leading system message for a prompt and tool set.

    Absent when both are empty, so an empty transcript stays empty rather than gaining a
    system message that says nothing.
    """

    has_system_prompt = system_prompt is not None and len(system_prompt) > 0
    has_tools = tools is not None and len(tools) > 0
    if not has_system_prompt and not has_tools:
        return None
    message = SystemMessage(content=system_prompt or "", timestamp=0)
    if has_tools:
        message.toolsAdded = list(tools or [])
    return message


def normalize_context(context: Context) -> TranscriptContext:
    """Fold the shorthand prompt and tools into a leading system message."""

    initial_message = create_initial_system_message(context.systemPrompt, context.tools)
    messages: list[Message] = list(context.messages)
    if initial_message is not None:
        messages.insert(0, initial_message)
    return TranscriptContext(messages=messages)


def get_initial_system_message(messages: Sequence[Message]) -> SystemMessage | None:
    """The leading system message, when the transcript starts with one."""

    if not messages:
        return None
    first = messages[0]
    return first if isinstance(first, SystemMessage) else None


def without_initial_system_message(messages: list[Message]) -> list[Message]:
    """Drop the leading system message, for transports that carry the prompt separately."""

    if get_initial_system_message(messages) is not None:
        return messages[1:]
    return messages


def get_current_tools(messages: Sequence[Message]) -> list[Tool]:
    """The tools available after applying every transcript delta in order.

    A re-added tool keeps its original position, because that order is the order tools are
    sent to the provider.
    """

    tools: dict[str, Tool] = {}
    for message in messages:
        if not isinstance(message, SystemMessage):
            continue
        if message.replace:
            tools.clear()
        for removed in message.toolsRemoved or []:
            tools.pop(removed.name, None)
        for added in message.toolsAdded or []:
            tools[added.name] = added
    return list(tools.values())


def get_current_system_message(messages: Sequence[Message]) -> SystemMessage | None:
    """Replay every system message into the prompt and tools in effect now.

    Later ``content`` is appended to the base prompt, sections are patched by name with
    ``None`` removing one, and a message marked ``replace`` starts over.
    """

    content: list[str] = []
    sections: dict[str, str] = {}
    timestamp: int | None = None
    for message in messages:
        if not isinstance(message, SystemMessage):
            continue
        if message.replace:
            content.clear()
            sections.clear()
        if timestamp is None:
            timestamp = message.timestamp
        text = contentText(message.content)
        if len(text) > 0:
            content.append(text)
        for name, value in (message.sections or {}).items():
            if value is None:
                sections.pop(name, None)
            else:
                sections[name] = value

    tools = get_current_tools(messages)
    if timestamp is None and len(tools) == 0:
        return None

    result = SystemMessage(content="\n\n".join(content), timestamp=timestamp or 0)
    if sections:
        result.sections = dict(sections)
    if tools:
        result.toolsAdded = tools
    return result


def get_current_system_prompt(messages: Sequence[Message]) -> str:
    """The prompt text after replaying every system message."""

    message = get_current_system_message(messages)
    return getSystemMessageText(message) if message is not None else ""


def collapse_system_messages(context: TranscriptContext) -> TranscriptContext:
    """Rebuild a transcript for transports without mid-conversation system messages.

    The replayed message leads and every later system message is dropped.
    """

    head = get_current_system_message(context.messages)
    rest: list[Message] = [
        message for message in context.messages if not isinstance(message, SystemMessage)
    ]
    combined: list[Message] = [head, *rest] if head is not None else rest
    return TranscriptContext(messages=combined)


def resolve_transcript(
    context: TranscriptContext,
    supports_mid_convo_system_messages: bool | None,
) -> TranscriptContext:
    """Keep later system messages when the model accepts them, and collapse them otherwise.

    A replacement after the leading message always collapses: no provider can retract a
    prompt it already received, so the replayed state has to become the leading prompt.
    """

    late_replacement = any(
        index > 0 and isinstance(message, SystemMessage) and message.replace is True
        for index, message in enumerate(context.messages)
    )
    if supports_mid_convo_system_messages and not late_replacement:
        return context
    return collapse_system_messages(context)


def _to_jsonable(value: Any) -> Any:
    """Render a declaration as plain data with mapping keys in a fixed order.

    Sorting the keys is what makes two declarations comparable: the same interface built
    two different ways has to serialize identically, and a mapping's insertion order must
    not be what decides whether a tool looks redeclared.
    """

    if isinstance(value, Tool):
        declaration: dict[str, Any] = {
            "name": value.name,
            "description": value.description,
            "parameters": _to_jsonable(value.parameters),
        }
        if value.constrainedSampling is not None:
            declaration["constrainedSampling"] = _to_jsonable(value.constrainedSampling)
        return declaration
    if isinstance(value, dict):
        return {key: _to_jsonable(item) for key, item in sorted(value.items())}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(item) for item in value]
    if hasattr(value, "__dataclass_fields__"):
        return _to_jsonable(asdict(value))
    return value


def to_tool_declaration(tool: Tool) -> Tool:
    """Strip everything but the model-visible declaration from a tool.

    The parameters are deep-copied, so a caller that mutates its schema afterwards does not
    change what the transcript records.
    """

    copied = Tool(
        name=tool.name,
        description=tool.description,
        parameters=json.loads(json.dumps(_to_jsonable(tool.parameters))),
    )
    if tool.constrainedSampling is not None:
        copied.constrainedSampling = tool.constrainedSampling
    return copied


def declarations_equal(left: Tool, right: Tool) -> bool:
    """Whether two tools declare the same interface to the model.

    Both sides are normalized first, so the comparison sees the same fields in the same
    order regardless of how each value was built.
    """

    left_text = json.dumps(_to_jsonable(to_tool_declaration(left)))
    right_text = json.dumps(_to_jsonable(to_tool_declaration(right)))
    return left_text == right_text


class ToolStateChanges:
    """The deltas that turn one tool state into another."""

    def __init__(self, tools_added: list[Tool], tools_removed: list[ToolReference]) -> None:
        self.toolsAdded = tools_added
        self.toolsRemoved = tools_removed


def get_tool_state_changes(
    previous: Sequence[Tool],
    current: Sequence[Tool],
) -> ToolStateChanges:
    """Compare two complete tool states.

    A tool whose declaration changed counts as a removal followed by an addition, because a
    transport that references tools by name cannot express a redefinition.
    """

    previous_tools = {tool.name: tool for tool in previous}
    current_tools = {tool.name: tool for tool in current}

    added = [
        to_tool_declaration(tool)
        for tool in current
        if tool.name not in previous_tools
        or not declarations_equal(previous_tools[tool.name], tool)
    ]
    removed = [
        ToolReference(name=tool.name)
        for tool in previous
        if tool.name not in current_tools
        or not declarations_equal(tool, current_tools[tool.name])
    ]
    return ToolStateChanges(tools_added=added, tools_removed=removed)


def get_declared_tools(messages: Sequence[Message]) -> list[Tool]:
    """Every definition the transcript references, in first-declaration order."""

    definitions: dict[str, Tool] = {}
    for message in messages:
        if not isinstance(message, SystemMessage):
            continue
        for tool in message.toolsAdded or []:
            definitions[tool.name] = tool
    return list(definitions.values())


def has_tool_redefinitions(messages: Sequence[Message]) -> bool:
    """Whether a tool name was declared twice with different definitions.

    A transport that references tools by name cannot express that.
    """

    declared: dict[str, Tool] = {}
    for message in messages:
        if not isinstance(message, SystemMessage):
            continue
        for tool in message.toolsAdded or []:
            previous = declared.get(tool.name)
            if previous is not None and not declarations_equal(previous, tool):
                return True
            declared[tool.name] = tool
    return False


def has_non_additive_tool_changes(messages: Sequence[Message]) -> bool:
    """Whether tool history contains a removal or a redeclaration.

    Either one rules out a transport that can only add tools as the transcript progresses.
    """

    declared: set[str] = set()
    for message in messages:
        if not isinstance(message, SystemMessage):
            continue
        if len(message.toolsRemoved or []) > 0:
            return True
        for tool in message.toolsAdded or []:
            if tool.name in declared:
                return True
            declared.add(tool.name)
    return False


class TranscriptTools:
    """How tool declarations are split between the request field and in-place additions."""

    def __init__(self, request_tools: list[Tool], anchors_additions: bool) -> None:
        self.requestTools = request_tools
        self.anchorsAdditions = anchors_additions


def resolve_transcript_tools(
    messages: Sequence[Message],
    supports_tool_additions: bool,
) -> TranscriptTools:
    """Split tool declarations between the top-level request field and in-place additions.

    A transport that can anchor an addition at a system message keeps the initial tools in
    the request and loads later ones where they appear. That only works when no tool was
    removed or redeclared, so anything else sends the current complete list instead.
    """

    anchors_additions = supports_tool_additions and not has_non_additive_tool_changes(messages)
    initial = get_initial_system_message(messages)
    request_tools = (
        list(initial.toolsAdded or [])
        if anchors_additions and initial is not None
        else get_current_tools(messages)
    )
    return TranscriptTools(request_tools=request_tools, anchors_additions=anchors_additions)
