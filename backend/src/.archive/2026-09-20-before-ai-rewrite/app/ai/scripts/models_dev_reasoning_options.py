"""Turning a provider's stated reasoning options into the levels this layer offers.

Providers describe reasoning in their own terms: a toggle, a set of effort names, or a token
budget. What the layer needs is a map from its own levels to the value the provider expects,
where a level mapped to null is one the model cannot be asked for.

Two effort names have no equivalent here and are dropped rather than approximated: the
provider's default, which is not a level a caller can choose, and an explicit null.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.ai.types import ModelThinkingLevel, ThinkingLevel

__all__ = [
    "THINKING_LEVELS",
    "EffortValue",
    "ModelsDevReasoningOption",
    "getEffortThinkingLevelMap",
]

THINKING_LEVELS: tuple[ThinkingLevel, ...] = (
    ThinkingLevel.MINIMAL,
    ThinkingLevel.LOW,
    ThinkingLevel.MEDIUM,
    ThinkingLevel.HIGH,
    ThinkingLevel.XHIGH,
    ThinkingLevel.MAX,
)

# An effort name a provider may list. ``default`` and ``none`` are not levels this layer
# offers, though ``none`` does map onto turning reasoning off.
EffortValue = str


@dataclass(slots=True)
class ModelsDevReasoningOption:
    """One way a provider describes reasoning, as its catalogue states it."""

    type: Literal["toggle", "effort", "budget_tokens"]
    values: list[EffortValue | None] = field(default_factory=list)
    minimum: int | None = None
    maximum: int | None = None


def getEffortThinkingLevelMap(
    options: list[ModelsDevReasoningOption],
) -> dict[ModelThinkingLevel, str | None] | None:
    """The level map for a model described in terms of effort values.

    ``None`` means the description says nothing usable about reasoning. ``off`` maps to the
    provider's ``none`` only when it offers one, because asking a model to turn reasoning off
    is not the same as being unable to.
    """

    effort_values = [
        value for option in options if option.type == "effort" for value in option.values
    ]
    if not effort_values:
        return None

    supported = set(effort_values)
    if not any(level.value in supported for level in THINKING_LEVELS) and "none" not in supported:
        return None

    mapping: dict[ModelThinkingLevel, str | None] = {
        ModelThinkingLevel.OFF: "none" if "none" in supported else None,
    }
    for level in THINKING_LEVELS:
        mapping[ModelThinkingLevel(level.value)] = level.value if level.value in supported else None
    return mapping
