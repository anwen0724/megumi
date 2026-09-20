"""Replay instructions and tool declarations through public transcript operations."""

from app.ai.messages import Context, SystemMessage, ToolDefinition, UserMessage
from app.ai.transcript import normalize_context


def test_context_adds_only_nonempty_initial_instructions():
    user = UserMessage(content="Hello", timestamp=1)
    context = Context(messages=[user], system_prompt="Guide")
    result = normalize_context(context)
    assert result.messages == [SystemMessage(content="Guide", timestamp=0), user]
    assert context.messages == [user]
    assert normalize_context(Context(messages=[user])).messages == [user]
    assert normalize_context(Context(messages=[], system_prompt="")).messages == []


def test_system_sections_append_remove_replace_and_keep_original_timestamp():
    from app.ai.transcript import (
        get_current_system_message,
        get_current_system_prompt,
        render_system_message_update,
    )

    history = [
        SystemMessage(content="A", timestamp=7, sections={"first": "one", "second": "two"}),
        UserMessage(content="Hi", timestamp=8),
        SystemMessage(content="B", timestamp=9, sections={"first": "new", "third": "three"}),
        SystemMessage(content="", timestamp=10, sections={"second": None}),
    ]
    assert get_current_system_prompt(history) == "A\n\nB\n\nnew\n\nthree"
    current = get_current_system_message(history)
    assert current.timestamp == 7
    assert list(current.sections) == ["first", "third"]
    assert render_system_message_update(history[-1]) == 'Removed system prompt section "second".'
    assert render_system_message_update(history[2]) == (
        'B\n\nUpdated system prompt section "first":\n\nnew'
        '\n\nUpdated system prompt section "third":\n\nthree'
    )
    history.append(SystemMessage(content="Reset", timestamp=11, replace=True))
    assert get_current_system_message(history) == SystemMessage(content="Reset", timestamp=7)
    assert history[0].sections["first"] == "one"


def tool(name, description="old"):
    return ToolDefinition(name=name, description=description, parameters={"type": "object"})


def test_tools_overwrite_preserve_position_remove_before_add_and_replace():
    from app.ai.transcript import get_current_system_message, get_current_tools

    a, b, new = tool("a"), tool("b"), tool("a", "new")
    history = [
        SystemMessage(content="", timestamp=0, tools_added=[a, b]),
        SystemMessage(content="", timestamp=1, tools_added=[new]),
    ]
    assert get_current_tools(history) == [new, b]
    history.append(
        SystemMessage(content="", timestamp=2, tools_removed=["a"], tools_added=[a, new])
    )
    assert get_current_tools(history) == [b, new]
    assert get_current_system_message(history).tools_added == [b, new]
    history.append(SystemMessage(content="", timestamp=3, replace=True, tools_added=[a]))
    assert get_current_tools(history) == [a]
    assert history[0].tools_added == [a, b]


def test_protocol_capabilities_choose_in_place_or_collapsed_history():
    from app.ai.messages import Transcript
    from app.ai.transcript import resolve_transcript, resolve_transcript_tools

    a, b = tool("a"), tool("b")
    user = UserMessage(content="continue", timestamp=1)
    history = [
        SystemMessage(content="A", timestamp=0, tools_added=[a]),
        user,
        SystemMessage(content="B", timestamp=2, tools_added=[b]),
    ]
    context = Transcript(messages=history)
    assert resolve_transcript(context, True).messages == history
    folded = resolve_transcript(context, False)
    assert folded.messages == [
        SystemMessage(content="A\n\nB", timestamp=0, tools_added=[a, b]),
        user,
    ]
    anchored = resolve_transcript_tools(history, True)
    assert anchored.anchors_additions and anchored.request_tools == [a]
    assert resolve_transcript_tools(history, False).request_tools == [a, b]
    history.append(SystemMessage(content="", timestamp=3, tools_added=[a]))
    assert not resolve_transcript_tools(history, True).anchors_additions
    history.append(SystemMessage(content="Reset", timestamp=4, replace=True))
    assert resolve_transcript(context, True).messages == [
        SystemMessage(content="Reset", timestamp=0),
        user,
    ]


def test_declarations_strip_callbacks_and_compare_serialized_schema_order():
    from app.ai.transcript import declarations_equal, get_tool_state_changes, to_tool_declaration

    a = tool("a")
    a.execute = lambda: None
    clean = to_tool_declaration(a)
    assert not hasattr(clean, "execute")
    assert declarations_equal(a, clean)
    changed = tool("a", "changed")
    changes = get_tool_state_changes([a], [changed, tool("b")])
    assert changes.tools_removed == ["a"]
    assert changes.tools_added == [changed, tool("b")]
    clean.parameters["title"] = "new"
    assert "title" not in a.parameters
    first = tool("x")
    second = tool("x")
    first.parameters = {"type": "object", "properties": {}}
    second.parameters = {"properties": {}, "type": "object"}
    assert not declarations_equal(first, second)


def test_system_text_blocks_round_trip_and_render_with_pi_separators():
    from app.ai.codec import decode_messages, encode_messages
    from app.ai.messages import TextContent
    from app.ai.transcript import get_current_system_prompt, render_system_message_update

    history = [
        SystemMessage(content=[TextContent(text="A"), TextContent(text="B")], timestamp=0),
        SystemMessage(content=[TextContent(text="C")], timestamp=1, sections={"s": "D"}),
    ]
    assert decode_messages(encode_messages(history)) == history
    assert get_current_system_prompt(history) == "A\nB\n\nC\n\nD"
    assert (
        render_system_message_update(history[1]) == 'C\n\nUpdated system prompt section "s":\n\nD'
    )
