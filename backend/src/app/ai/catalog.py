"""Validate complete catalogs before publishing provider configuration."""

import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import fields
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qsl, urlsplit

from app.ai.errors import ConfigurationError
from app.ai.model import CatalogSource, Model, ModelCapabilities, ModelCompat, Pricing, PricingTier
from app.ai.provider import Provider, copy_provider


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
    if not isinstance(headers, Mapping):
        raise ConfigurationError("Headers must be a mapping")
    for name, value in headers.items():
        if not isinstance(name, str) or (value is not None and not isinstance(value, str)):
            raise ConfigurationError("Invalid header name or value type")
        if name.lower() in {"host", "content-length"}:
            raise ConfigurationError("Cannot override a managed header")
        if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name):
            raise ConfigurationError("Invalid header name")
        if value is not None and ("\r" in value or "\n" in value):
            raise ConfigurationError("Invalid header value")


def snapshot_provider(provider: Provider) -> Provider:
    """Validate a complete provider before its atomic publication."""
    if not provider.id.strip() or not provider.name.strip():
        raise ConfigurationError("Provider identity must be nonempty")
    if not callable(getattr(provider.auth.api_key, "resolve", None)):
        raise ConfigurationError("Provider requires API key authentication behavior")
    validate_url(provider.base_url)
    validate_headers(provider.headers)
    validate_models(provider.id, provider.get_models())
    return copy_provider(provider)


def validate_models(provider_id: str, models: Sequence[Model]) -> None:
    """运行时目录与维护工具共用模型校验, 不把协议可执行性混入目录数据。"""
    seen: set[str] = set()
    for model in models:
        if (
            not model.id.strip()
            or model.id in seen
            or model.provider != provider_id
            or not isinstance(model.api, str)
            or not model.api.strip()
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
        validate_model_metadata(model)
        seen.add(model.id)


COMPAT_CHOICES = {
    "system_role": {"system", "developer"},
    "max_tokens_field": {"max_tokens", "max_completion_tokens"},
    "thinking_format": {"openai", "deepseek"},
    "session_affinity_format": {"openai", "openai-nosession", "openrouter"},
}


def validate_json(value: object) -> None:
    """采样扩展只接受 JSON 数据; 不将对象、集合或非有限数偷偷字符串化。"""
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float) and math.isfinite(value):
        return
    if isinstance(value, Mapping):
        for key, child in value.items():
            if not isinstance(key, str):
                raise ConfigurationError("sampling_params: JSON keys must be strings")
            validate_json(child)
        return
    if isinstance(value, list):
        for child in value:
            validate_json(child)
        return
    raise ConfigurationError("sampling_params: expected finite JSON data")


def validate_model_metadata(model: Model) -> None:
    """目录加载和注册共享元数据约束, 保留 None 与未声明的区别。"""
    if model.sampling_params is not None:
        if not isinstance(model.sampling_params, Mapping):
            raise ConfigurationError("sampling_params: expected object")
        validate_json(model.sampling_params)
    for definition in fields(model.compat):
        value = getattr(model.compat, definition.name)
        if definition.name == "temperature_requires_reasoning_off":
            if type(value) is not bool:
                raise ConfigurationError("Invalid sampling compatibility declaration")
        elif value is not None:
            choices = COMPAT_CHOICES.get(definition.name)
            if (choices is not None and (not isinstance(value, str) or value not in choices)) or (
                choices is None and type(value) is not bool
            ):
                raise ConfigurationError(f"Invalid compat.{definition.name}")
    caps = model.capabilities
    if not caps.input_modalities or not set(caps.input_modalities) <= {"text", "image"}:
        raise ConfigurationError("Invalid input modality declaration")
    if any(type(value) is not bool for value in (caps.tools, caps.temperature, caps.reasoning)):
        raise ConfigurationError("Invalid boolean capability")
    levels = {"off", "minimal", "low", "medium", "high", "xhigh", "max"}
    if not isinstance(caps.reasoning_levels, Mapping) or any(
        level not in levels
        or (target is not None and (not isinstance(target, str) or not target.strip()))
        for level, target in caps.reasoning_levels.items()
    ):
        raise ConfigurationError("Invalid reasoning mapping")


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
            compat_data = data.pop("compat", {})
            if not isinstance(compat_data, dict) or compat_data.keys() - {
                field.name for field in fields(ModelCompat)
            }:
                raise ConfigurationError("Invalid or unknown compat fields")
            compat = ModelCompat(**compat_data)
            models.append(
                Model(
                    **data,
                    capabilities=ModelCapabilities(**capabilities),
                    pricing=Pricing(**pricing),
                    compat=compat,
                    source=CatalogSource(**source) if source is not None else None,
                )
            )
        for model in models:
            validate_model_metadata(model)
        return tuple(models)
    except ConfigurationError:
        raise
    except (TypeError, ValueError, KeyError, InvalidOperation):
        raise ConfigurationError("Invalid static catalog structure") from None
