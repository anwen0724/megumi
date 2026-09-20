"""Model metadata independent of provider SDKs and transport."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class ModelCapabilities:
    """Explicit input, tool, reasoning and sampling capabilities."""

    input_modalities: tuple[str, ...] = ("text",)
    tools: bool = False
    reasoning: bool = False
    reasoning_levels: Mapping[str, str | None] = field(default_factory=dict)
    temperature: bool = True


@dataclass(frozen=True, slots=True)
class PricingTier:
    """Conditional rates in the parent pricing currency and token unit.

    Conditions are descriptive metadata, not executable billing rules.
    """

    condition: str
    input: Decimal | None = None
    output: Decimal | None = None
    cache_read: Decimal | None = None
    cache_write: Decimal | None = None


@dataclass(frozen=True, slots=True)
class Pricing:
    """Rates per unit_tokens; None means unknown rather than free."""

    currency: str = "USD"
    unit_tokens: int = 1_000_000
    tiers: tuple[PricingTier, ...] = ()
    input: Decimal | None = None
    output: Decimal | None = None
    cache_read: Decimal | None = None
    cache_write: Decimal | None = None


@dataclass(frozen=True, slots=True)
class CatalogSource:
    """Source and verification date for maintained model metadata."""

    url: str
    checked_at: str


@dataclass(frozen=True, slots=True)
class ModelCompat:
    """Declared protocol differences used by subsequent request adapters."""

    # None 保留未配置语义, 协议默认由适配器选择。
    system_role: str | None = None
    supports_developer_role: bool | None = None
    supports_store: bool | None = None
    supports_reasoning_effort: bool | None = None
    supports_usage_in_streaming: bool | None = None
    supports_finish_reason: bool | None = None
    max_tokens_field: str | None = None
    thinking_format: str | None = None
    requires_reasoning_content_on_assistant_messages: bool | None = None
    supports_strict_mode: bool | None = None
    supports_mid_convo_system_messages: bool | None = None
    supports_mid_convo_tool_additions: bool | None = None
    supports_additional_tools: bool | None = None
    supports_tool_search: bool | None = None
    supports_long_cache_retention: bool | None = None
    supports_explicit_prompt_cache_mode: bool | None = None
    supports_max_output_tokens: bool | None = None
    send_session_affinity_headers: bool | None = None
    session_affinity_format: str | None = None
    temperature_requires_reasoning_off: bool = False


@dataclass(frozen=True, slots=True)
class Model:
    """A provider-qualified model definition, containing no credentials."""

    id: str
    name: str
    provider: str
    api: str
    context_window: int
    max_output_tokens: int
    base_url: str | None = None
    headers: Mapping[str, str | None] = field(default_factory=dict)
    capabilities: ModelCapabilities = field(default_factory=ModelCapabilities)
    pricing: Pricing = field(default_factory=Pricing)
    compat: ModelCompat = field(default_factory=ModelCompat)
    sampling_params: Mapping[str, object] | None = None
    source: CatalogSource | None = None


THINKING_LEVELS = ("off", "minimal", "low", "medium", "high", "xhigh", "max")


def get_supported_thinking_levels(model: Model) -> tuple[str, ...]:
    """按 pi 语义区分不推理、未指定等级和显式不支持。"""
    if not model.capabilities.reasoning:
        return ("off",)
    mapping = model.capabilities.reasoning_levels
    return tuple(
        level
        for level in THINKING_LEVELS
        if (level not in mapping or mapping[level] is not None)
        and (level not in {"xhigh", "max"} or level in mapping)
    )


def clamp_thinking_level(model: Model, level: str) -> str:
    """保留已支持等级, 否则先向上再向下寻找; 空列表回退 off。"""
    available = get_supported_thinking_levels(model)
    if level in available:
        return level
    if level in THINKING_LEVELS:
        index = THINKING_LEVELS.index(level)
        for candidate in (*THINKING_LEVELS[index:], *reversed(THINKING_LEVELS[:index])):
            if candidate in available:
                return candidate
    return available[0] if available else "off"
