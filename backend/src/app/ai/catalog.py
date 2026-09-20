"""Validate complete catalogs before publishing provider configuration."""

import json
import re
from collections.abc import Mapping
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qsl, urlsplit

from app.ai.errors import ConfigurationError
from app.ai.model import CatalogSource, Model, ModelCapabilities, ModelCompat, Pricing, PricingTier
from app.ai.provider import Provider

SUPPORTED_APIS = frozenset({"openai-completions", "openai-responses"})


def validate_url(value: str) -> None:
    """Reject endpoints that are not absolute HTTP URLs or embed credentials."""
    try:
        parsed = urlsplit(value)
        query_names = [re.sub("[^a-z]", "", key.lower()) for key, _ in parse_qsl(parsed.query)]
        secret_names = {
            "key",
            "apikey",
            "token",
            "accesstoken",
            "password",
            "secret",
            "authorization",
            "credential",
            "signature",
        }
        invalid = (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or any(c.isspace() for c in value)
            or bool(secret_names.intersection(query_names))
        )
        _ = parsed.port
    except ValueError:
        invalid = True
    if invalid:
        raise ConfigurationError(
            "Invalid base_url; use an absolute HTTP(S) endpoint without credentials"
        )


def validate_headers(headers: Mapping[str, str | None]) -> None:
    """Validate header syntax without echoing potentially sensitive values."""
    for name, value in headers.items():
        if name.lower() in {"authorization", "host", "content-length"}:
            raise ConfigurationError("Cannot override a managed header")
        if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name):
            raise ConfigurationError("Invalid header name")
        if value is not None and ("\r" in value or "\n" in value):
            raise ConfigurationError("Invalid header value")


def snapshot_provider(provider: Provider) -> Provider:
    """Validate a complete provider before its atomic publication."""
    if not provider.id.strip() or not provider.name.strip() or not provider.env_var.strip():
        raise ConfigurationError(
            "Provider identity and authentication declaration must be nonempty"
        )
    if provider.api not in SUPPORTED_APIS:
        raise ConfigurationError("Unsupported protocol declaration")
    validate_url(provider.base_url)
    validate_headers(provider.headers)
    seen: set[str] = set()
    for model in provider.models:
        if (
            not model.id.strip()
            or model.id in seen
            or model.provider != provider.id
            or model.api != provider.api
        ):
            raise ConfigurationError("Invalid model identity or protocol declaration")
        for count in (model.context_window, model.max_output_tokens):
            if type(count) is not int or count <= 0:
                raise ConfigurationError("Model token limits must be positive integers")
        if model.base_url is not None:
            validate_url(model.base_url)
        validate_headers(model.headers)
        pricing = model.pricing
        if (
            not pricing.currency.strip()
            or type(pricing.unit_tokens) is not int
            or pricing.unit_tokens <= 0
        ):
            raise ConfigurationError("Invalid pricing currency or unit")
        rate_groups: tuple[Pricing | PricingTier, ...] = (pricing, *pricing.tiers)
        for rates in rate_groups:
            if isinstance(rates, PricingTier) and not rates.condition.strip():
                raise ConfigurationError("Pricing tiers require a billing condition")
            for rate in (rates.input, rates.output, rates.cache_read, rates.cache_write):
                if rate is not None and (
                    not isinstance(rate, Decimal) or not rate.is_finite() or rate < 0
                ):
                    raise ConfigurationError(
                        "Prices must be finite nonnegative decimals or unknown"
                    )
        if type(model.compat.temperature_requires_reasoning_off) is not bool:
            raise ConfigurationError("Invalid sampling compatibility declaration")
        caps = model.capabilities
        if not caps.input_modalities or not set(caps.input_modalities) <= {"text", "image"}:
            raise ConfigurationError("Invalid input modality declaration")
        if type(caps.tools) is not bool or type(caps.temperature) is not bool:
            raise ConfigurationError("Invalid boolean capability")
        levels = {"off", "minimal", "low", "medium", "high", "xhigh", "max"}
        if any(
            level not in levels or not target.strip()
            for level, target in caps.reasoning_levels.items()
        ):
            raise ConfigurationError("Invalid reasoning mapping")
        seen.add(model.id)
    return deepcopy(provider)


def load_catalog(text: str) -> tuple[Model, ...]:
    """Decode maintained package data; provider validation follows in its factory."""
    try:
        entries = json.loads(text)
        if not isinstance(entries, list):
            raise TypeError
        models = []
        for entry in entries:
            data = dict(entry)
            pricing = dict(data.pop("pricing", {}))
            tiers = pricing.pop("tiers", [])
            for rates in [pricing, *tiers]:
                for field in ("input", "output", "cache_read", "cache_write"):
                    rate = rates.get(field)
                    if rate is not None:
                        if not isinstance(rate, str):
                            raise TypeError
                        rates[field] = Decimal(rate)
            pricing["tiers"] = tuple(PricingTier(**tier) for tier in tiers)
            capabilities = dict(data.pop("capabilities", {}))
            if "input_modalities" in capabilities:
                capabilities["input_modalities"] = tuple(capabilities["input_modalities"])
            source = data.pop("source", None)
            compat = ModelCompat(**data.pop("compat", {}))
            models.append(
                Model(
                    **data,
                    capabilities=ModelCapabilities(**capabilities),
                    pricing=Pricing(**pricing),
                    compat=compat,
                    source=CatalogSource(**source) if source is not None else None,
                )
            )
        return tuple(models)
    except (TypeError, ValueError, KeyError, InvalidOperation):
        raise ConfigurationError("Invalid static catalog structure") from None
