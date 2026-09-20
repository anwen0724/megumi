"""Model metadata independent of provider SDKs and transport."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class ModelCapabilities:
    """Explicit input, tool, reasoning and sampling capabilities."""

    input_modalities: tuple[str, ...] = ("text",)
    tools: bool = False
    reasoning_levels: Mapping[str, str] = field(default_factory=dict)
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

    system_role: str = "system"
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
    source: CatalogSource | None = None
