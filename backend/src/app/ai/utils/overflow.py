"""Recognizes a response that failed because the request did not fit the context window.

There is no single signal for this. Most providers report an error whose text names the
overflow, and the wording differs per provider; some accept the request and report usage
that already exceeds the window; one truncates the input to fill the window exactly and
then stops for length with no room left to answer. All three are detected here.

The exclusion list matters as much as the match list: a throttling error can contain the
words a generic overflow pattern looks for, so a known non-overflow error is ruled out
before any overflow pattern is tested.
"""

from __future__ import annotations

import re

from app.ai.types import AssistantMessage, StopReason

__all__ = [
    "getOverflowPatterns",
    "isContextOverflow",
    "isRecoverableLength",
]

# Provider error wording that means "the input did not fit".
_OVERFLOW_SOURCES = [
    r"prompt is too long",  # Anthropic token overflow
    r"request_too_large",  # Anthropic request byte-size overflow (HTTP 413)
    r"input is too long for requested model",  # Amazon Bedrock
    r"exceeds the context window",  # OpenAI (Completions & Responses API)
    r"exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))",
    r"input token count.*exceeds the maximum",  # Google (Gemini)
    r"maximum prompt length is \d+",  # xAI (Grok)
    r"reduce the length of the messages",  # Groq
    r"maximum context length is \d+ tokens",  # OpenRouter (most backends)
    r"exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?",  # OpenRouter/Poolside
    r"input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)",
    r"exceeds the limit of \d+",  # GitHub Copilot
    r"exceeds the available context size",  # llama.cpp server
    r"greater than the context length",  # LM Studio
    r"context window exceeds limit",  # MiniMax
    r"exceeded model token limit",  # Kimi For Coding
    r"too large for model with \d+ maximum context length",  # Mistral
    r"prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?",  # DS4
    r"model_context_window_exceeded",  # z.ai non-standard finish_reason as error text
    r"prompt too long; exceeded (?:max )?context length",  # Ollama explicit overflow
    r"range of input length should be",  # DashScope / Qwen Token Plan
    r"context[_ ]length[_ ]exceeded",  # generic fallback
    r"too many tokens",  # generic fallback
    r"token limit exceeded",  # generic fallback
    r"^4(?:00|13)\s*(?:status code)?\s*\(no body\)",  # Cerebras: 400/413 with no body
]

# Errors that contain overflow wording but are not overflow.
_NON_OVERFLOW_SOURCES = [
    r"^(Throttling error|Service unavailable):",  # Bedrock, via its error formatter
    r"rate limit",
    r"too many requests",
]

_OVERFLOW_PATTERNS = [re.compile(source, re.IGNORECASE) for source in _OVERFLOW_SOURCES]
_NON_OVERFLOW_PATTERNS = [
    re.compile(source, re.IGNORECASE) for source in _NON_OVERFLOW_SOURCES
]

# The share of the context window that counts as "the input filled it" when a provider
# truncates instead of refusing.
_FILLED_CONTEXT_SHARE = 0.99


def getOverflowPatterns() -> list[re.Pattern[str]]:
    """The overflow patterns, for callers that need to test their own error text."""

    return list(_OVERFLOW_PATTERNS)


def isContextOverflow(message: AssistantMessage, contextWindow: int | None = None) -> bool:
    """Whether ``message`` shows that the request did not fit the model's context window.

    ``contextWindow`` is only needed for the providers that do not report overflow as an
    error: without it their behaviour cannot be distinguished from a normal response.
    """

    if message.stopReason == StopReason.ERROR and message.errorMessage:
        error_message = message.errorMessage
        is_non_overflow = any(
            pattern.search(error_message) for pattern in _NON_OVERFLOW_PATTERNS
        )
        if not is_non_overflow and any(
            pattern.search(error_message) for pattern in _OVERFLOW_PATTERNS
        ):
            return True

    if contextWindow and message.stopReason == StopReason.STOP:
        input_tokens = message.usage.input + message.usage.cacheRead
        if input_tokens > contextWindow:
            return True

    if (
        contextWindow
        and message.stopReason == StopReason.LENGTH
        and message.usage.output == 0
    ):
        input_tokens = message.usage.input + message.usage.cacheRead
        if input_tokens >= contextWindow * _FILLED_CONTEXT_SHARE:
            return True

    return False


def isRecoverableLength(message: AssistantMessage, desiredMaxOutput: int) -> bool:
    """Whether a length stop ended below the caller's intended output limit.

    Such a response may be caused by context pressure or provider-side truncation, so a
    caller can make one bounded compact-and-retry attempt. ``desiredMaxOutput`` must be the
    limit before any context-based clamping.
    """

    return (
        message.stopReason == StopReason.LENGTH
        and desiredMaxOutput > 0
        and message.usage.output < desiredMaxOutput
    )
