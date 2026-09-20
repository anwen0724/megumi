"""Tests for the context estimate and the overflow classifier.

The overflow cases cover each of the three detection routes and, importantly, the
exclusions: a throttling error that mentions tokens must not be read as an overflow, or a
caller would try to compact a transcript that was never too large.
"""

from __future__ import annotations

import pytest

from app.ai.types import (
    AssistantMessage,
    ImageContent,
    StopReason,
    SystemMessage,
    TextContent,
    Tool,
    TranscriptContext,
    Usage,
    UsageCost,
    UserMessage,
)
from app.ai.utils.estimate import (
    ESTIMATED_IMAGE_CHARS,
    calculateContextTokens,
    estimateContextTokens,
    estimateMessageTokens,
    estimateTextAndImageContentTokens,
    estimateTextTokens,
)
from app.ai.utils.overflow import getOverflowPatterns, isContextOverflow, isRecoverableLength


def _usage(
    *,
    input: int = 0,
    output: int = 0,
    cacheRead: int = 0,
    cacheWrite: int = 0,
    totalTokens: int = 0,
) -> Usage:
    return Usage(
        input=input,
        output=output,
        cacheRead=cacheRead,
        cacheWrite=cacheWrite,
        totalTokens=totalTokens,
        cost=UsageCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0, total=0.0),
    )


def _assistant(
    *,
    usage: Usage | None = None,
    stop_reason: StopReason = StopReason.STOP,
    timestamp: int = 0,
    error_message: str | None = None,
) -> AssistantMessage:
    return AssistantMessage(
        content=[],
        api="openai-completions",
        provider="openai",
        model="m",
        usage=usage if usage is not None else _usage(),
        stopReason=stop_reason,
        timestamp=timestamp,
        errorMessage=error_message,
    )


class TestEstimate:
    def test_calculate_context_tokens_prefers_the_total(self) -> None:
        usage = _usage(input=1, output=2, cacheRead=3, cacheWrite=4, totalTokens=99)

        assert calculateContextTokens(usage) == 99

    def test_calculate_context_tokens_falls_back_to_the_parts(self) -> None:
        usage = _usage(input=1, output=2, cacheRead=3, cacheWrite=4)

        assert calculateContextTokens(usage) == 10

    def test_text_tokens_round_up(self) -> None:
        assert estimateTextTokens("") == 0
        assert estimateTextTokens("abcd") == 1
        assert estimateTextTokens("abcde") == 2

    def test_content_tokens_charge_a_fixed_cost_per_image(self) -> None:
        content = [TextContent(text="abcd"), ImageContent(data="x", mimeType="image/png")]

        assert estimateTextAndImageContentTokens(content) == (
            4 + ESTIMATED_IMAGE_CHARS
        ) // 4

    def test_content_tokens_accept_a_plain_string(self) -> None:
        assert estimateTextAndImageContentTokens("abcdefgh") == 2

    def test_user_message_tokens_follow_its_content(self) -> None:
        assert estimateMessageTokens(UserMessage(content="abcdefgh", timestamp=0)) == 2

    def test_system_message_tokens_include_its_tools(self) -> None:
        message = SystemMessage(
            content="abcdefgh",
            timestamp=0,
            toolsAdded=[Tool(name="t", description="d", parameters={"type": "object"})],
        )

        assert estimateMessageTokens(message) > 2

    def test_system_message_without_tools_is_just_its_text(self) -> None:
        assert estimateMessageTokens(SystemMessage(content="abcdefgh", timestamp=0)) == 2

    def test_a_transcript_without_usage_is_fully_estimated(self) -> None:
        messages = [UserMessage(content="abcdefgh", timestamp=0)]

        estimate = estimateContextTokens(messages)

        assert estimate.usageTokens == 0
        assert estimate.trailingTokens == estimate.tokens
        assert estimate.lastUsageIndex is None

    def test_reported_usage_is_used_for_everything_before_it(self) -> None:
        messages = [
            UserMessage(content="abcdefgh", timestamp=0),
            _assistant(usage=_usage(input=1000, totalTokens=1000), timestamp=1),
        ]

        estimate = estimateContextTokens(messages)

        assert estimate.usageTokens == 1000
        assert estimate.trailingTokens == 0
        assert estimate.tokens == 1000
        assert estimate.lastUsageIndex == 1

    def test_only_the_messages_after_the_usage_block_are_estimated(self) -> None:
        messages = [
            _assistant(usage=_usage(input=1000, totalTokens=1000), timestamp=0),
            UserMessage(content="abcdefgh", timestamp=1),
        ]

        estimate = estimateContextTokens(messages)

        assert estimate.usageTokens == 1000
        assert estimate.trailingTokens == 2
        assert estimate.tokens == 1002
        assert estimate.lastUsageIndex == 0

    def test_usage_older_than_a_later_message_is_ignored(self) -> None:
        # The message's own timestamp is compared against the newest prefix timestamp seen
        # so far, so a response emitted before a later-prefix message cannot describe the
        # prefix that message belongs to.
        messages = [
            _assistant(usage=_usage(input=1000, totalTokens=1000), timestamp=5),
            UserMessage(content="abcdefgh", timestamp=5),
            _assistant(usage=_usage(input=2000, totalTokens=2000), timestamp=4),
        ]

        estimate = estimateContextTokens(messages)

        # The second response (timestamp 4) is older than the prefix it follows, so the
        # first response's usage remains the newest applicable one.
        assert estimate.lastUsageIndex == 0
        assert estimate.usageTokens == 1000

    def test_a_later_response_supersedes_an_earlier_one(self) -> None:
        messages = [
            _assistant(usage=_usage(input=1000, totalTokens=1000), timestamp=1),
            UserMessage(content="abcdefgh", timestamp=2),
            _assistant(usage=_usage(input=2000, totalTokens=2000), timestamp=3),
        ]

        estimate = estimateContextTokens(messages)

        assert estimate.lastUsageIndex == 2
        assert estimate.usageTokens == 2000
        assert estimate.trailingTokens == 0

    def test_aborted_and_failed_responses_do_not_supply_usage(self) -> None:
        for stop_reason in (StopReason.ABORTED, StopReason.ERROR):
            messages = [
                _assistant(
                    usage=_usage(input=1000, totalTokens=1000),
                    stop_reason=stop_reason,
                    timestamp=0,
                ),
            ]

            assert estimateContextTokens(messages).lastUsageIndex is None

    def test_a_transcript_context_is_accepted_directly(self) -> None:
        context = TranscriptContext(messages=[UserMessage(content="abcdefgh", timestamp=0)])

        assert estimateContextTokens(context).tokens == 2


class TestOverflow:
    @pytest.mark.parametrize(
        "error_message",
        [
            "prompt is too long: 213462 tokens > 200000 maximum",
            '413 {"error":{"type":"request_too_large"}}',
            "Your input exceeds the context window of this model",
            "Requested token count exceeds the model's maximum context length of 131072 tokens",
            "Input length (265330) exceeds model's maximum context length (262144).",
            "The input token count (1196265) exceeds the maximum number of tokens allowed",
            "This model's maximum prompt length is 131072 but the request contains 537812 tokens",
            "Please reduce the length of the messages or completion",
            "This endpoint's maximum context length is 200000 tokens.",
            "Input length 300000 exceeds the maximum allowed input length of 200000 tokens.",
            "The input (300000 tokens) is longer than the model's context length (200000 tokens).",
            "the request exceeds the available context size, try increasing it",
            "tokens to keep from the initial prompt is greater than the context length",
            "invalid params, context window exceeds limit",
            "Your request exceeded model token limit: 300000 (requested: 200000)",
            "Prompt contains 300000 tokens ... too large for model with 200000 maximum"
            " context length",
            "Prompt has 300000 tokens, but the configured context size is 200000 tokens",
            "model_context_window_exceeded",
            "prompt too long; exceeded max context length by 100 tokens",
            "Range of input length should be [1, 200000]",
            "prompt token count of 300000 exceeds the limit of 200000",
            "400 status code (no body)",
            "413 status code (no body)",
        ],
    )
    def test_error_wording_is_recognized(self, error_message: str) -> None:
        message = _assistant(
            stop_reason=StopReason.ERROR,
            error_message=error_message,
        )

        assert isContextOverflow(message) is True

    @pytest.mark.parametrize(
        "error_message",
        [
            # Bedrock reports throttling with words a generic overflow pattern looks for;
            # the exclusion list keys on the prefixes its error formatter produces.
            "Throttling error: Too many tokens, please wait before trying again.",
            "Service unavailable: too many tokens",
            "Rate limit reached for requests",
            "429 Too Many Requests",
        ],
    )
    def test_non_overflow_errors_are_excluded(self, error_message: str) -> None:
        message = _assistant(
            stop_reason=StopReason.ERROR,
            error_message=error_message,
        )

        assert isContextOverflow(message) is False

    def test_an_unrelated_error_is_not_overflow(self) -> None:
        message = _assistant(
            stop_reason=StopReason.ERROR,
            error_message="invalid API key",
        )

        assert isContextOverflow(message) is False

    def test_an_error_without_a_message_is_not_overflow(self) -> None:
        assert isContextOverflow(_assistant(stop_reason=StopReason.ERROR)) is False

    def test_silent_overflow_is_detected_from_usage(self) -> None:
        message = _assistant(usage=_usage(input=300_000, cacheRead=0, totalTokens=300_000))

        assert isContextOverflow(message, 200_000) is True
        # Without the window there is nothing to compare against.
        assert isContextOverflow(message) is False

    def test_silent_overflow_counts_cached_input(self) -> None:
        message = _assistant(usage=_usage(input=100_000, cacheRead=150_000, totalTokens=250_000))

        assert isContextOverflow(message, 200_000) is True

    def test_usage_within_the_window_is_not_overflow(self) -> None:
        message = _assistant(usage=_usage(input=1000, totalTokens=1000))

        assert isContextOverflow(message, 200_000) is False

    def test_truncating_providers_are_detected_by_a_filled_window(self) -> None:
        message = _assistant(
            usage=_usage(input=199_500, totalTokens=199_500),
            stop_reason=StopReason.LENGTH,
        )

        assert isContextOverflow(message, 200_000) is True

    def test_a_length_stop_with_output_left_is_not_overflow(self) -> None:
        message = _assistant(
            usage=_usage(input=199_500, output=100, totalTokens=199_600),
            stop_reason=StopReason.LENGTH,
        )

        assert isContextOverflow(message, 200_000) is False

    def test_truncation_detection_needs_the_window(self) -> None:
        message = _assistant(
            usage=_usage(input=199_500, totalTokens=199_500),
            stop_reason=StopReason.LENGTH,
        )

        assert isContextOverflow(message) is False

    def test_pattern_list_is_returned_as_a_copy(self) -> None:
        patterns = getOverflowPatterns()

        assert len(patterns) == 25
        patterns.clear()

        assert len(getOverflowPatterns()) == 25

    @pytest.mark.parametrize(
        ("output", "desired", "expected"),
        [
            (10, 100, True),
            (100, 100, False),
            (10, 0, False),
        ],
    )
    def test_recoverable_length_needs_room_left(
        self,
        output: int,
        desired: int,
        expected: bool,
    ) -> None:
        message = _assistant(
            usage=_usage(output=output),
            stop_reason=StopReason.LENGTH,
        )

        assert isRecoverableLength(message, desired) is expected

    def test_a_stop_is_never_a_recoverable_length(self) -> None:
        assert isRecoverableLength(_assistant(usage=_usage(output=10)), 100) is False
