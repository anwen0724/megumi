"""Deriving the options a simple request actually sends.

A caller of a simplified entry point supplies a reasoning level and, at most, a ceiling on
the answer length. This module turns that into concrete request options: the max-token
value is clamped so the request cannot exceed the model's context window, and the thinking
budget is fitted inside the same ceiling, because on the servers that share one limit
between reasoning and answer a reasoning-heavy turn can otherwise consume the whole
response and emit no answer at all.
"""

from __future__ import annotations

from dataclasses import replace

from app.ai.types import (
    Model,
    SimpleStreamOptions,
    StreamOptions,
    ThinkingBudgets,
    ThinkingLevel,
    TranscriptContext,
)
from app.ai.utils.estimate import estimateContextTokens

__all__ = [
    "DEFAULT_THINKING_BUDGETS",
    "MIN_ANSWER_TOKENS",
    "adjust_max_tokens_for_thinking",
    "build_base_options",
    "clamp_max_tokens_to_context",
    "clamp_reasoning",
    "clamp_thinking_budget_to_answer_room",
    "thinking_budget_for_level",
]

# Tokens held back from the context window so a request that just fits does not overflow on
# the server's own accounting.
CONTEXT_SAFETY_TOKENS = 4096
MIN_MAX_TOKENS = 1

# Tokens always left for the answer when a thinking budget shares the response ceiling.
MIN_ANSWER_TOKENS = 1024

DEFAULT_THINKING_BUDGETS = ThinkingBudgets(
    minimal=1024,
    low=2048,
    medium=8192,
    high=16384,
)


def clamp_max_tokens_to_context(model: Model, context: TranscriptContext, max_tokens: int) -> int:
    """Cap ``max_tokens`` so the request fits the model's remaining context window."""

    if model.contextWindow <= 0:
        return max(MIN_MAX_TOKENS, max_tokens)
    available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS
    return min(max_tokens, max(MIN_MAX_TOKENS, available))


def build_base_options(
    model: Model,
    context: TranscriptContext,
    options: SimpleStreamOptions | None,
    api_key: str | None,
) -> StreamOptions:
    """Carry the shared request options over from the simplified form.

    Sampling parameters merge per key, with the request's own keys winning over the model's
    defaults.
    """

    sampling_params: dict[str, object] | None = None
    if model.samplingParams or (options and options.samplingParams):
        sampling_params = {
            **(model.samplingParams or {}),
            **((options.samplingParams if options else None) or {}),
        }

    requested_max = (options.maxTokens if options else None) or model.maxTokens
    return StreamOptions(
        temperature=options.temperature if options else None,
        samplingParams=sampling_params,
        maxTokens=clamp_max_tokens_to_context(model, context, requested_max),
        signal=options.signal if options else None,
        telemetryContext=options.telemetryContext if options else None,
        apiKey=api_key or (options.apiKey if options else None),
        fetch=options.fetch if options else None,
        transport=options.transport if options else None,
        cacheRetention=options.cacheRetention if options else None,
        sessionId=options.sessionId if options else None,
        headers=options.headers if options else None,
        onPayload=options.onPayload if options else None,
        onResponse=options.onResponse if options else None,
        timeoutMs=options.timeoutMs if options else None,
        websocketConnectTimeoutMs=options.websocketConnectTimeoutMs if options else None,
        maxRetries=options.maxRetries if options else None,
        maxRetryDelayMs=options.maxRetryDelayMs if options else None,
        metadata=options.metadata if options else None,
        env=options.env if options else None,
    )


def clamp_reasoning(effort: ThinkingLevel | None) -> ThinkingLevel | None:
    """Reduce a level the request cannot express to the closest one it can."""

    if effort in (ThinkingLevel.XHIGH, ThinkingLevel.MAX):
        return ThinkingLevel.HIGH
    return effort


def thinking_budget_for_level(
    reasoning_level: ThinkingLevel,
    custom_budgets: ThinkingBudgets | None = None,
) -> int:
    """The thinking budget for ``reasoning_level``, with caller overrides applied."""

    budgets = replace(DEFAULT_THINKING_BUDGETS)
    if custom_budgets is not None:
        for name in ("minimal", "low", "medium", "high"):
            override = getattr(custom_budgets, name)
            if override is not None:
                setattr(budgets, name, override)
    level = clamp_reasoning(reasoning_level)
    return getattr(budgets, str(level)) or MIN_ANSWER_TOKENS


def clamp_thinking_budget_to_answer_room(thinking_budget: int, ceiling: int) -> int:
    """Cap a thinking budget so the answer keeps ``MIN_ANSWER_TOKENS`` under ``ceiling``."""

    return min(thinking_budget, max(0, ceiling - MIN_ANSWER_TOKENS))


def adjust_max_tokens_for_thinking(
    base_max_tokens: int | None,
    model_max_tokens: int,
    reasoning_level: ThinkingLevel,
    custom_budgets: ThinkingBudgets | None = None,
) -> tuple[int, int]:
    """The max-token value and thinking budget to send for a reasoning request.

    ``base_max_tokens`` is ``None`` when the caller set no ceiling; the model's own limit is
    then used and the thinking budget has to fit inside it.
    """

    thinking_budget = thinking_budget_for_level(reasoning_level, custom_budgets)
    max_tokens = (
        model_max_tokens
        if base_max_tokens is None
        else min(base_max_tokens + thinking_budget, model_max_tokens)
    )
    if max_tokens <= thinking_budget:
        thinking_budget = clamp_thinking_budget_to_answer_room(thinking_budget, max_tokens)
    return max_tokens, thinking_budget
