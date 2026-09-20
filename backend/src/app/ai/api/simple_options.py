"""Prepare simple call preferences; protocol wire mapping remains in adapters."""

import os
from copy import deepcopy
from dataclasses import replace
from typing import cast

from app.ai.context_budget import clamp_max_tokens_to_context
from app.ai.messages import JSONValue, Transcript
from app.ai.model import Model, clamp_thinking_level
from app.ai.options import ReasoningLevel, SimpleOptions, snapshot_options


def prepare_simple_options(
    model: Model, transcript: Transcript, options: SimpleOptions
) -> SimpleOptions:
    """Merge model sampling defaults, scope cache preferences and clamp output room."""
    result = snapshot_options(options)
    sampling = {**(model.sampling_params or {}), **(result.sampling_params or {})}
    cache_env = (
        result.env.get("PI_CACHE_RETENTION")
        if "PI_CACHE_RETENTION" in result.env
        else os.getenv("PI_CACHE_RETENTION")
    )
    return replace(
        result,
        sampling_params=cast(dict[str, JSONValue], deepcopy(sampling)) if sampling else None,
        max_output_tokens=clamp_max_tokens_to_context(
            model, transcript, result.max_output_tokens or model.max_output_tokens
        ),
        cache_retention=result.cache_retention or ("long" if cache_env == "long" else "short"),
        reasoning=cast(ReasoningLevel, clamp_thinking_level(model, result.reasoning))
        if result.reasoning
        else None,
    )
