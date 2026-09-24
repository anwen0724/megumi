"""Context estimates use reported anchors without inventing missing usage."""

from copy import deepcopy

from app.ai.context_budget import estimate_context_tokens
from app.ai.messages import (
    AssistantMessage,
    ImageContent,
    SystemMessage,
    TextContent,
    Tool,
    ToolCall,
    Transcript,
    Usage,
    UserMessage,
)


def test_text_estimate_uses_utf16_units_without_mutating_input():
    transcript = Transcript(messages=[UserMessage(content="a😀bc", timestamp=1)])
    estimate = estimate_context_tokens(transcript)
    assert (
        estimate.tokens,
        estimate.usage_tokens,
        estimate.trailing_tokens,
        estimate.last_usage_index,
    ) == (2, 0, 2, None)
    assert transcript.messages[0].content == "a😀bc"


def assistant(usage=None, **kwargs):
    return AssistantMessage(
        content=[TextContent(text="abcd")],
        provider="p",
        api="a",
        model="m",
        timestamp=kwargs.pop("timestamp", 2),
        usage=usage or Usage(),
        stop_reason=kwargs.pop("stop_reason", "stop"),
        **kwargs,
    )


def test_images_tools_and_unknown_usage_are_estimated():
    # Image 1200, text 1, tool name + compact arguments = 2, tool list JSON (47 UTF-16 units) = 12.
    messages = [
        UserMessage(
            content=[ImageContent(data="abc", mime_type="image/png"), TextContent(text="abc")],
            timestamp=1,
        ),
        AssistantMessage(
            content=[ToolCall(id="1", name="f", arguments={"x": 1})],
            provider="p",
            api="a",
            model="m",
            timestamp=2,
        ),
        SystemMessage(
            content="",
            timestamp=3,
            tools_added=[Tool(name="f", description="", parameters={})],
        ),
    ]
    before = deepcopy(messages)
    estimate = estimate_context_tokens(Transcript(messages=messages))
    assert estimate.tokens == 1215
    assert messages == before


def test_known_total_is_anchor_even_with_unknown_components_and_newer_unknown_usage():
    messages = [
        UserMessage(content="old", timestamp=1),
        assistant(Usage(total_tokens=9000)),
        assistant(timestamp=3),
        UserMessage(content="abcde", timestamp=4),
    ]
    estimate = estimate_context_tokens(Transcript(messages=messages))
    assert (
        estimate.tokens,
        estimate.usage_tokens,
        estimate.trailing_tokens,
        estimate.last_usage_index,
    ) == (9003, 9000, 3, 1)


def test_complete_components_anchor_and_invalid_prefix_or_error_do_not():
    usage = Usage(input=20, output=4, cache_read=6, cache_write=0, reasoning=3)
    assert estimate_context_tokens(Transcript(messages=[assistant(usage)])).tokens == 30
    for message in [
        assistant(Usage(input=8000)),
        assistant(usage, stop_reason="error"),
        assistant(usage, stop_reason="aborted"),
        assistant(Usage(total_tokens=0)),
    ]:
        estimate = estimate_context_tokens(Transcript(messages=[message]))
        assert (estimate.tokens, estimate.last_usage_index) == (1, None)
    estimate = estimate_context_tokens(
        Transcript(messages=[UserMessage(content="new", timestamp=10), assistant(usage)])
    )
    assert (estimate.tokens, estimate.last_usage_index) == (2, None)


def test_output_and_thinking_budgets(provider):
    from dataclasses import replace

    from app.ai.context_budget import adjust_max_tokens_for_thinking, clamp_max_tokens_to_context

    model = replace(provider.get_models()[0], context_window=10000, max_output_tokens=8000)
    context = Transcript(messages=[assistant(Usage(total_tokens=5000))])
    assert clamp_max_tokens_to_context(model, context, 8000) == 904
    assert (
        clamp_max_tokens_to_context(
            model, Transcript(messages=[assistant(Usage(total_tokens=20000))]), 8000
        )
        == 1
    )
    assert adjust_max_tokens_for_thinking(None, 4000, "high") == (4000, 2976)
    assert adjust_max_tokens_for_thinking(2000, 10000, "minimal") == (3024, 1024)
    assert adjust_max_tokens_for_thinking(2000, 10000, "max", {"high": 500}) == (2500, 500)


def test_overflow_and_length_require_evidence():
    from app.ai.context_budget import is_context_overflow, is_recoverable_length

    assert is_context_overflow(
        assistant(stop_reason="error", error_message="context_length_exceeded")
    )
    assert not is_context_overflow(
        assistant(stop_reason="error", error_message="rate limit: too many tokens")
    )
    assert is_context_overflow(assistant(Usage(input=900, cache_read=200)), 1000)
    assert not is_context_overflow(assistant(Usage(input=900, cache_read=None)), 1000)
    assert is_context_overflow(
        assistant(Usage(input=990, cache_read=0, output=0), stop_reason="length"), 1000
    )
    assert not is_recoverable_length(assistant(stop_reason="length"), 2000)
    assert is_recoverable_length(assistant(Usage(output=500), stop_reason="length"), 2000)
    assert not is_recoverable_length(assistant(Usage(output=2000), stop_reason="length"), 2000)
