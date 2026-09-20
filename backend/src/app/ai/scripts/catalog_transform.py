"""Build runtime catalogs from source facts and explicit provider rules."""

from decimal import Decimal, InvalidOperation
from typing import Any

from app.ai.catalog import load_catalog, snapshot_provider
from app.ai.provider import Provider
from app.ai.scripts.catalog_io import CatalogError, digest, encode


def reasoning(raw: dict[str, Any], rule: dict[str, Any]) -> dict[str, str]:
    """Map only declared effort values and separately verified toggle semantics."""
    if type(raw.get("reasoning")) is not bool:
        raise CatalogError("reasoning: missing boolean capability")
    if raw["reasoning"] is False:
        return {}
    options = raw.get("reasoning_options")
    if not isinstance(options, list) or not options:
        raise CatalogError("reasoning: missing options")
    result: dict[str, str] = {}
    for option in options:
        if option.get("type") == "effort" and isinstance(option.get("values"), list):
            for value in option["values"]:
                if value in (None, "default"):
                    continue
                if value not in rule["reasoning_map"]:
                    raise CatalogError(f"reasoning: unmapped effort {value}")
                result[rule["reasoning_map"][value]] = value
        elif option.get("type") == "toggle" and rule.get("toggle_map"):
            result.update(rule["toggle_map"])
        else:
            raise CatalogError(f"reasoning: unsupported option {option}")
    return result


RATES = ("input", "output", "cache_read", "cache_write")


def rates(data: dict[str, Any]) -> dict[str, str | None]:
    """Serialize finite nonnegative fees; missing values remain unknown."""
    result: dict[str, str | None] = {}
    for field in RATES:
        value = data.get(field)
        if value is None:
            result[field] = None
            continue
        try:
            if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
                raise ValueError
            number = Decimal(value)
            if not number.is_finite() or number < 0:
                raise ValueError
        except (ValueError, InvalidOperation):
            raise CatalogError(f"pricing.{field}: invalid decimal rate") from None
        result[field] = str(number)
    return result


def pricing(raw: dict[str, Any], rule: dict[str, Any]) -> dict[str, Any]:
    """Never relabel source money into a different currency."""
    cost = raw.get("cost", {})
    result = {
        "currency": rule["currency"],
        "unit_tokens": rule["unit_tokens"],
        **rates(cost),
        "tiers": [],
    }
    if rule["currency"] != rule["source_currency"]:
        result.update(dict.fromkeys(RATES))
    return result


def base_model(raw: dict[str, Any], rule: dict[str, Any], report: list[str]) -> dict[str, Any]:
    """Convert source facts without borrowing missing values from runtime defaults."""
    modalities = raw.get("modalities", {}).get("input")
    if not isinstance(modalities, list) or any(not isinstance(v, str) for v in modalities):
        raise CatalogError("input_modalities: missing list")
    supported = [m for m in modalities if m in {"text", "image"}]
    for value in modalities:
        if value not in supported:
            report.append(f"{raw['id']}: not exposed input modality {value}")
    limits = raw.get("limit", {})
    model = {
        "id": raw["id"],
        "name": raw.get("name"),
        "provider": rule["id"],
        "api": rule["api"],
        "capabilities": {
            "tools": True,
            "input_modalities": supported,
            "temperature": raw.get("temperature"),
            "reasoning_levels": reasoning(raw, rule),
        },
        "source": None,
        "pricing": pricing(raw, rule),
    }
    for output, source in (("context_window", "context"), ("max_output_tokens", "output")):
        if source in limits:
            model[output] = limits[source]
    return model


def validate_model(model: dict[str, Any], rule: dict[str, Any]) -> None:
    """Validate required source facts then delegate runtime constraints to the real loader."""
    for field in ("context_window", "max_output_tokens"):
        if type(model.get(field)) is not int or model[field] <= 0:
            raise CatalogError(f"{field}: expected positive integer")
    if not isinstance(model.get("name"), str) or not model["name"].strip():
        raise CatalogError("name: expected nonempty string")
    caps = model["capabilities"]
    for field in ("temperature", "tools"):
        if type(caps.get(field)) is not bool:
            raise CatalogError(f"{field}: expected boolean")
    try:
        snapshot_provider(
            Provider(
                id=rule["id"],
                name=rule["name"],
                api=rule["api"],
                base_url=rule["base_url"],
                env_var=rule["env_var"],
                models=load_catalog(encode([model]).decode()),
            )
        )
    except (ValueError, TypeError, AttributeError) as exc:
        raise CatalogError(f"runtime model validation: {exc}") from exc


def generate_catalog(
    snapshot: dict[str, Any], rule: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, Any], list[str]]:
    """Return validated models, provenance and discovery diagnostics."""
    if snapshot.get("schema_version") != 1 or snapshot.get("content_hash") != digest(
        encode(snapshot.get("data"))
    ):
        raise CatalogError(f"{rule['id']}: invalid snapshot version or hash")
    upstream = snapshot["data"]["models"]
    if not isinstance(upstream, dict) or not upstream:
        raise CatalogError(f"{rule['id']}: empty or invalid upstream")
    if "included" in rule:
        raise CatalogError("Manual included lists are not supported")
    models: list[dict[str, Any]] = []
    report: list[str] = []
    exclusions = {item["model_id"]: item for item in rule["excluded"]}
    if len(exclusions) != len(rule["excluded"]):
        raise CatalogError("Duplicate exclusions")
    for identity, raw in sorted(upstream.items()):
        try:
            if not isinstance(raw, dict) or raw.get("id") != identity:
                raise CatalogError("identity: upstream key and model id must match")
            if raw.get("tool_call") is not True:
                report.append(f"{identity}: tool_call is not true")
                continue
            if identity in exclusions:
                report.append(f"{identity}: excluded: {exclusions[identity]['reason']}")
                continue
            model = base_model(raw, rule, report)
            validate_model(model, rule)
            models.append(model)
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise CatalogError(f"{rule['id']}/{identity}: {exc}") from exc
    if not models:
        raise CatalogError(f"{rule['id']}: empty candidate catalog")
    for identity in sorted(exclusions.keys() - upstream.keys()):
        report.append(f"{identity}: unmatched exclusion")
    return models, {}, report
