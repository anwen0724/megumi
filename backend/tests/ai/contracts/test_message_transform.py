"""Outbound history repairs are independent of the caller's original transcript."""

from copy import deepcopy

import pytest

from app.ai.api.transform import transform_messages
from app.ai.messages import (
    AssistantMessage,
    SystemMessage,
    TextContent,
    ToolCall,
    ToolResultMessage,
    UserMessage,
)


def assistant(provider, content, stop_reason="tool_use"):
    model = provider.models[0]
    return AssistantMessage(
        content=content,
        provider=model.provider,
        api=model.api,
        model=model.id,
        timestamp=1,
        stop_reason=stop_reason,
    )


def test_real_results_hold_system_until_after_results(provider):
    history = [
        assistant(provider, [ToolCall(id="a", name="t", arguments={})]),
        SystemMessage(content="new instruction", timestamp=2),
        ToolResultMessage(
            tool_call_id="a",
            tool_name="t",
            content=[TextContent(text="ok")],
            is_error=False,
            timestamp=3,
        ),
        UserMessage(content="next", timestamp=4),
    ]
    original = deepcopy(history)
    assert transform_messages(history, provider.models[0]) == [
        history[0],
        history[2],
        history[1],
        history[3],
    ]
    assert history == original


@pytest.mark.parametrize("boundary", ["user", "assistant", "end", "error", "aborted"])
def test_missing_results_close_at_turn_boundaries_without_replaying_failed_calls(
    provider, monkeypatch, boundary
):
    import time

    monkeypatch.setattr(time, "time_ns", lambda: 123456000000)
    start = assistant(
        provider,
        [
            ToolCall(id="a", name="first", arguments={}),
            ToolCall(id="b", name="second", arguments={}),
        ],
    )
    actual = ToolResultMessage(
        tool_call_id="b", tool_name="second", content=[], is_error=False, timestamp=2
    )
    system = SystemMessage(content="later", timestamp=3)
    suffix = (
        []
        if boundary == "end"
        else [
            UserMessage(content="next", timestamp=4)
            if boundary == "user"
            else assistant(
                provider, [], stop_reason=boundary if boundary in ("error", "aborted") else "stop"
            )
        ]
    )
    history = [start, system, actual, *suffix]
    original = deepcopy(history)
    result = transform_messages(history, provider.models[0])
    assert result[:4] == [
        start,
        actual,
        ToolResultMessage(
            tool_call_id="a",
            tool_name="first",
            content=[TextContent(text="No result provided")],
            is_error=True,
            timestamp=123456,
        ),
        system,
    ]
    assert result[4:] == ([] if boundary in ("error", "aborted", "end") else suffix)
    assert history == original


def test_reasoning_and_signatures_follow_full_model_identity(provider):
    from dataclasses import replace

    from app.ai.messages import ThinkingContent

    content = [
        ThinkingContent(thinking="", thinking_signature="signed"),
        ThinkingContent(thinking="secret", redacted=True, thinking_signature="opaque"),
        ThinkingContent(thinking="  "),
        ThinkingContent(thinking="visible"),
        TextContent(text="answer", text_signature="item"),
    ]
    history = [assistant(provider, content, "stop")]
    same = transform_messages(history, provider.models[0])[0]
    assert same.content == [content[0], content[1], content[3], content[4]]
    for field in ("provider", "api", "id"):
        target = replace(provider.models[0], **{field: "other"})
        cross = transform_messages(history, target)[0]
        assert cross.content == [TextContent(text="visible"), TextContent(text="answer")]
    assert len(history[0].content) == 5


def test_images_ids_and_null_content_are_normalized_without_editing_input(provider):
    from dataclasses import replace

    from app.ai.messages import ImageContent

    image = ImageContent(mime_type="image/png", data="AA==")
    old = assistant(
        provider, [ToolCall(id="original|id", name="t", arguments={}, thought_signature="old")]
    )
    result = ToolResultMessage(
        tool_call_id="original|id",
        tool_name="t",
        content=[image, image],
        is_error=False,
        timestamp=3,
    )
    user = UserMessage(content=[image, image, TextContent(text="between"), image], timestamp=0)
    null_user = UserMessage(content=None, timestamp=4)
    history = [user, old, result, null_user]
    original = deepcopy(history)
    seen = []

    def normalize(call_id, target, source):
        seen.append((call_id, target.id, source.model))
        return "safe_id"

    target = replace(provider.models[0], id="other")
    output = transform_messages(history, target, normalize)
    assert [b.text for b in output[0].content] == [
        "(image omitted: model does not support images)",
        "between",
        "(image omitted: model does not support images)",
    ]
    assert output[1].content[0].id == output[2].tool_call_id == "safe_id"
    assert output[1].content[0].thought_signature is None
    assert output[2].content == [
        TextContent(text="(tool image omitted: model does not support images)")
    ]
    assert output[3].content == []
    assert seen == [("original|id", "other", "small")]
    assert history == original
    vision = replace(
        provider.models[0],
        capabilities=replace(provider.models[0].capabilities, input_modalities=("text", "image")),
    )
    assert transform_messages([user], vision)[0].content == user.content


def test_id_callback_observes_original_source_calls_even_after_prior_ids_change(provider):
    from dataclasses import replace

    source = assistant(
        provider,
        [
            ToolCall(id="first", name="t", arguments={}, thought_signature="signed"),
            ToolCall(id="second", name="t", arguments={}, thought_signature="signed"),
        ],
    )
    observed = []

    def normalize(call_id, target, original):
        observed.append([(call.id, call.thought_signature) for call in original.content])
        return "new-" + call_id

    transformed = transform_messages([source], replace(provider.models[0], id="other"), normalize)
    assert observed == [[("first", "signed"), ("second", "signed")]] * 2
    assert [c.id for c in transformed[0].content] == ["new-first", "new-second"]
