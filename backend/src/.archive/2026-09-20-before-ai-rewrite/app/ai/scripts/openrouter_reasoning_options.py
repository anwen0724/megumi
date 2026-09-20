"""Converting OpenRouter's reasoning metadata into the levels this layer offers.

OpenRouter names efforts the same way the catalogue does, so the conversion is shared rather
than written twice. What is specific to OpenRouter is the notion of mandatory reasoning: a
model that always reasons cannot be asked to turn it off, which is expressed by mapping
``off`` to null instead of to ``none``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.ai.scripts.models_dev_reasoning_options import (
    EffortValue,
    ModelsDevReasoningOption,
    getEffortThinkingLevelMap,
)
from app.ai.types import ModelThinkingLevel

__all__ = ["OpenRouterReasoningMetadata", "getOpenRouterThinkingLevelMap"]


@dataclass(slots=True)
class OpenRouterReasoningMetadata:
    """How OpenRouter describes a model's reasoning support."""

    mandatory: bool | None = None
    default_enabled: bool | None = None
    supported_efforts: list[EffortValue | None] = field(default_factory=list)
    default_effort: EffortValue | None = None


def getOpenRouterThinkingLevelMap(
    reasoning: OpenRouterReasoningMetadata | None,
) -> dict[ModelThinkingLevel, str | None] | None:
    """The level map for an OpenRouter model, from its reasoning metadata.

    A model whose reasoning is mandatory gets ``off`` mapped to null, so a caller asking for
    no reasoning is refused rather than silently ignored. A model that says nothing about its
    reasoning yields ``None``.
    """

    if reasoning is None:
        return None
    if not reasoning.supported_efforts:
        return {ModelThinkingLevel.OFF: None} if reasoning.mandatory is True else None

    # The effort values are the same vocabulary the catalogue uses, so the same conversion
    # applies to both sources.
    mapping = getEffortThinkingLevelMap(
        [ModelsDevReasoningOption(type="effort", values=list(reasoning.supported_efforts))],
    )
    if mapping is None:
        return {ModelThinkingLevel.OFF: None} if reasoning.mandatory is True else None
    mapping[ModelThinkingLevel.OFF] = None if reasoning.mandatory is True else "none"
    return mapping
