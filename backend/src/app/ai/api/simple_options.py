"""Prepare simple call preferences; protocol wire mapping remains in adapters."""

from dataclasses import replace
from typing import cast

from app.ai.context_budget import clamp_max_tokens_to_context
from app.ai.messages import Transcript
from app.ai.model import Model, clamp_thinking_level
from app.ai.options import ReasoningLevel, SimpleOptions, prepare_call_options


def prepare_simple_options(
    model: Model, transcript: Transcript, options: SimpleOptions
) -> SimpleOptions:
    """Merge model sampling defaults, scope cache preferences and clamp output room."""
    result = prepare_call_options(model, options)
    return replace(
        result,
        max_output_tokens=clamp_max_tokens_to_context(
            model,
            transcript,
            result.max_output_tokens
            if result.max_output_tokens is not None
            else model.max_output_tokens,
        ),
        reasoning=cast(ReasoningLevel, clamp_thinking_level(model, result.reasoning))
        if result.reasoning
        else None,
    )
