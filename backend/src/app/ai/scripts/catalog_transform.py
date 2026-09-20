"""Build runtime catalogs from source facts and explicit provider rules."""

from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.ai.catalog import load_catalog, snapshot_provider, validate_url
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
    for level, target in rule.get("reasoning_aliases", {}).items():
        if target in result.values():
            result[level] = target
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
    if not isinstance(cost, dict):
        raise CatalogError("pricing: expected cost object")
    allowed = {*RATES, "tiers", "context_over_200k", "reasoning"}
    if cost.keys() - allowed:
        raise CatalogError(f"pricing: uninterpretable fields {sorted(cost.keys() - allowed)}")
    base = rates(cost)
    if "reasoning" in cost and rates({"output": cost["reasoning"]})["output"] != base["output"]:
        raise CatalogError("pricing: separate reasoning price cannot be represented")
    tiers = cost.get("tiers", [])
    if not isinstance(tiers, list):
        raise CatalogError("pricing.tiers: expected array")
    thresholds: list[tuple[int, dict[str, Any]]] = []
    for tier in tiers:
        condition = tier.get("tier", {})
        size = condition.get("size")
        if (
            condition.get("type") != "context"
            or type(size) is not int
            or size <= 0
            or tier.keys() - {*RATES, "tier"}
        ):
            raise CatalogError("pricing.tiers: unknown condition or rates")
        thresholds.append((size, rates(tier)))
    thresholds.sort(key=lambda entry: entry[0])
    if len({size for size, _ in thresholds}) != len(thresholds):
        raise CatalogError("pricing.tiers: duplicate context threshold")
    # Prefer the explicit threshold over the legacy alias name (which can mean 272k).
    if "context_over_200k" in cost:
        legacy = rates(cost["context_over_200k"])
        if thresholds:
            if legacy != thresholds[0][1]:
                raise CatalogError("pricing.context_over_200k: conflicts with explicit tier")
        else:
            thresholds.append((200000, legacy))
    result: dict[str, Any] = {
        "currency": rule["currency"],
        "unit_tokens": rule["unit_tokens"],
        **base,
        "tiers": [],
    }
    scope = rule.get("price_condition", "")
    if thresholds or scope:
        scope = scope or "Standard service tier"
        upper = f"; input context <= {thresholds[0][0]} tokens" if thresholds else ""
        result["tiers"].append({"condition": scope + upper, **base})
        for index, (size, tier_rates) in enumerate(thresholds):
            upper = f" and <= {thresholds[index + 1][0]}" if index + 1 < len(thresholds) else ""
            result["tiers"].append(
                {"condition": f"{scope}; input context > {size}{upper} tokens", **tier_rates}
            )
        result.update(dict.fromkeys(RATES))
    modes = raw.get("experimental", {}).get("modes", {})
    for name, mode in sorted(modes.items()):
        if "cost" not in mode:
            continue
        body = mode.get("provider", {}).get("body", {})
        service = body.get("service_tier")
        if not isinstance(service, str) or body.keys() != {"service_tier"}:
            raise CatalogError(f"pricing mode {name}: uninterpretable service condition")
        condition = f"service_tier={service}; mode={name}"
        if thresholds and not mode["cost"].get("tiers"):
            condition += "; context range not supplied by upstream"
        mode_pricing = pricing({"cost": mode["cost"]}, {**rule, "price_condition": condition})
        result["tiers"].extend(mode_pricing["tiers"])
    if rule["currency"] != rule["source_currency"]:
        result.update(dict.fromkeys(RATES))
        result["tiers"] = []
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
        "compat": deepcopy(rule.get("compat", {})),
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
    caps = model.get("capabilities")
    if (
        not isinstance(caps, dict)
        or not {"tools", "temperature", "input_modalities", "reasoning_levels"} <= caps.keys()
    ):
        raise CatalogError("capabilities: incomplete model definition")
    if not isinstance(caps["reasoning_levels"], dict) or not isinstance(
        caps["input_modalities"], list
    ):
        raise CatalogError("capabilities: invalid modalities or reasoning mapping")
    price = model.get("pricing")
    if (
        not isinstance(price, dict)
        or not {"currency", "unit_tokens", *RATES, "tiers"} <= price.keys()
    ):
        raise CatalogError("pricing: a complete currency, unit and rate group is required")
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
    try:
        validate_url(snapshot["source_url"])
        if datetime.fromisoformat(snapshot["fetched_at"]).tzinfo is None:
            raise ValueError("fetched_at requires a timezone")
        if snapshot["data"].get("id") != rule["upstream_id"]:
            raise ValueError("wrong upstream provider identity")
    except (KeyError, ValueError, TypeError, AttributeError) as exc:
        raise CatalogError(f"{rule['id']}: invalid snapshot source: {exc}") from exc
    if type(snapshot.get("schema_version")) is not int or snapshot["schema_version"] != 1:
        raise CatalogError(f"{rule['id']}: invalid snapshot schema_version")
    if snapshot.get("content_hash") != digest(encode(snapshot.get("data"))):
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
    for item in exclusions.values():
        evidence(item)
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
            models.append(model)
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise CatalogError(f"{rule['id']}/{identity}: {exc}") from exc
    traces: dict[str, Any] = {
        model["id"]: {
            "fields": {
                path: {
                    "kind": "upstream",
                    "source_url": snapshot["source_url"],
                    "fetched_at": snapshot["fetched_at"],
                }
                for path in fields(model)
            },
            "patches": [],
            "reviews": [],
        }
        for model in models
    }
    for model in models:
        trace_fields = traces[model["id"]]["fields"]
        for path, record in trace_fields.items():
            source_path = SOURCE_PATHS.get(path)
            if path.startswith("pricing."):
                source_path = "cost"
            if path.startswith("capabilities.reasoning_levels"):
                source_path = "reasoning_options"
            if path in {
                "provider",
                "api",
                "pricing.currency",
                "pricing.unit_tokens",
            } or path.startswith("compat"):
                record["kind"] = "rule"
                record["rule_path"] = path.removeprefix("pricing.")
            elif path == "source":
                record["kind"] = "review_status"
            else:
                record["upstream_path"] = source_path or path
            record["rule_sources"] = deepcopy(rule.get("rule_sources", []))
    for item in rule["supplements"]:
        evidence(item)
        model = deepcopy(item["model"])
        identity = model.get("id")
        if (
            identity in upstream
            or identity in exclusions
            or identity in traces
            or model.get("capabilities", {}).get("tools") is not True
            or model.get("provider") != rule["id"]
            or model.get("api") != rule["api"]
        ):
            raise CatalogError(f"{rule['id']}/{identity}: invalid or conflicting supplement")
        model["source"] = deepcopy(item["source"])
        models.append(model)
        traces[model["id"]] = {
            "fields": {
                path: {"kind": "supplement", "source": item["source"], "reason": item["reason"]}
                for path in fields(model)
            },
            "patches": [],
            "reviews": [],
        }
    by_id = {model["id"]: model for model in models}
    touched: dict[str, set[str]] = {}
    for item in rule["patches"]:
        evidence(item)
        identity, path = item["model_id"], item["path"]
        used = touched.setdefault(identity, set())
        if path not in PATCH_PATHS or any(
            path == previous or path.startswith(previous + ".") or previous.startswith(path + ".")
            for previous in used
        ):
            raise CatalogError(f"{rule['id']}/{identity}: duplicate or invalid patch path {path}")
        used.add(path)
        if identity not in by_id:
            raise CatalogError(f"{rule['id']}/{identity}: patch target not in candidates")
        model = by_id[identity]
        parent = model
        parts = path.split(".")
        for key in parts[:-1]:
            if key not in parent or not isinstance(parent[key], dict):
                raise CatalogError(f"{identity}: missing parent for {path}")
            parent = parent[key]
        current = parent.get(parts[-1], MISSING)
        if encode(current) == encode(item["replacement"]):
            report.append(f"{identity}.{path}: redundant patch")
            status = "redundant"
        elif encode(current) == encode(item["expected"]):
            parent[parts[-1]] = deepcopy(item["replacement"])
            status = "applied"
        else:
            raise CatalogError(
                f"{rule['id']}/{identity}.{path}: stale patch; "
                f"expected {item['expected']!r}, got {current!r}; review required"
            )
        for field in list(traces[identity]["fields"]):
            if field == path or field.startswith(path + "."):
                del traces[identity]["fields"][field]
        replacement_fields = fields({parts[-1]: parent[parts[-1]]})
        for field in replacement_fields:
            actual_path = ".".join([*parts[:-1], field])
            traces[identity]["fields"][actual_path] = {
                "kind": "patch",
                "source": item["source"],
                "reason": item["reason"],
            }
        traces[identity]["patches"].append({**item, "status": status})
    for item in rule["reviews"]:
        evidence(item)
        identity = item["model_id"]
        if identity not in by_id:
            report.append(f"{identity}: unmatched review")
            continue
        current_fields = fields(by_id[identity])
        matched, stale = [], []
        for path, value in item["fields"].items():
            if path not in current_fields:
                stale.append(path)
            elif encode(current_fields[path]) == encode(value):
                matched.append(path)
                traces[identity]["fields"][path].update(
                    {"verified": True, "review_source": item["source"]}
                )
            else:
                stale.append(path)
        traces[identity]["reviews"].append(
            {**item, "matched": sorted(matched), "stale": sorted(stale)}
        )
        if matched:
            by_id[identity]["source"] = latest_source(by_id[identity].get("source"), item["source"])
    for model in models:
        for item in traces[model["id"]]["patches"]:
            model["source"] = latest_source(model.get("source"), item["source"])
        final_fields = fields(model)
        trace_fields = traces[model["id"]]["fields"]
        for path in list(trace_fields):
            if path not in final_fields:
                del trace_fields[path]
        for path, value in final_fields.items():
            record = trace_fields.setdefault(path, {"kind": "review_status"})
            record["value"] = deepcopy(value)
        try:
            validate_model(model, rule)
        except CatalogError as exc:
            raise CatalogError(f"{rule['id']}/{model['id']}: {exc}") from exc
    if not models:
        raise CatalogError(f"{rule['id']}: empty candidate catalog")
    for identity in sorted(exclusions.keys() - upstream.keys()):
        report.append(f"{identity}: unmatched exclusion")
    return sorted(models, key=lambda model: model["id"]), traces, report


def fields(value: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """Flatten object fields for provenance; arrays are indivisible values."""
    result = {}
    for name, child in value.items():
        path = f"{prefix}.{name}" if prefix else name
        if isinstance(child, dict) and child:
            result.update(fields(child, path))
        else:
            result[path] = child
    return result


MISSING = {"missing": True}
PATCH_PATHS = {
    "name",
    "context_window",
    "max_output_tokens",
    "base_url",
    "headers",
    "capabilities.input_modalities",
    "capabilities.temperature",
    "capabilities.reasoning_levels",
    "compat",
    "compat.system_role",
    "compat.temperature_requires_reasoning_off",
    "pricing",
    "pricing.input",
    "pricing.output",
    "pricing.cache_read",
    "pricing.cache_write",
    "pricing.tiers",
}


def evidence(item: dict[str, Any]) -> None:
    """Reject maintenance records that cannot be traced to a dated source."""
    try:
        source = item["source"]
        validate_url(source["url"])
        if date.fromisoformat(source["checked_at"]) > date.today():
            raise ValueError("future review date")
        if not isinstance(item["reason"], str) or not item["reason"].strip():
            raise ValueError("missing reason")
    except (KeyError, TypeError, ValueError) as exc:
        raise CatalogError(f"Invalid maintenance evidence: {exc}") from exc


def latest_source(previous: Any, current: dict[str, Any]) -> dict[str, Any]:
    """Keep the latest actual review date, never a fetch or generation timestamp."""
    if previous is None or current["checked_at"] >= previous["checked_at"]:
        return deepcopy(current)
    return dict(previous)


SOURCE_PATHS = {
    "context_window": "limit.context",
    "max_output_tokens": "limit.output",
    "capabilities.input_modalities": "modalities.input",
    "capabilities.tools": "tool_call",
    "capabilities.temperature": "temperature",
}
