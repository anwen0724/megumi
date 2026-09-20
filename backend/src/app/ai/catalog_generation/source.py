"""Fetch upstream provider data and load the catalog generator's maintained inputs."""

import re
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from app.ai.catalog_generation import CatalogError
from app.ai.catalog_generation.output import decode, digest, encode, publish

SOURCE_URL = "https://models.dev/api.json"


def download(url: str, timeout: float) -> bytes:
    """Bound network access to the explicit fetch operation."""
    request = Request(
        url, headers={"User-Agent": "Megumi-ModelCatalog/1.0", "Accept": "application/json"}
    )
    with urlopen(request, timeout=timeout) as response:
        return bytes(response.read())


def select_providers(rules: dict[str, Any], providers: list[str] | None = None) -> list[str]:
    """Validate selected identities before any network or filesystem mutation."""
    selected = sorted(set(providers if providers is not None else rules))
    for identity in selected:
        if (
            not re.fullmatch(r"[a-z][a-z0-9_-]*", identity)
            or identity in {"con", "prn", "aux", "nul", "manifest"}
            or re.fullmatch(r"(com|lpt)[0-9]", identity)
            or identity not in rules
            or rules[identity].get("id") != identity
        ):
            raise CatalogError(f"Unknown or unsafe provider: {identity}")
    if not selected:
        raise CatalogError("No providers selected")
    return selected


def fetch_snapshots(
    inputs: Path,
    rules: dict[str, Any],
    providers: list[str] | None = None,
    *,
    transport: Callable[[str, float], bytes] = download,
    fetched_at: str | None = None,
) -> list[str]:
    """Fetch selected upstream catalogs without touching runtime outputs."""
    selected = select_providers(rules, providers)
    try:
        source = decode(transport(SOURCE_URL, 30))
    except OSError as exc:
        raise CatalogError(f"Fetch {SOURCE_URL} failed: {exc}") from exc
    if not isinstance(source, dict):
        raise CatalogError("Upstream root must be an object")
    pending: dict[Path, bytes] = {}
    reports = []
    for identity in selected:
        data = source.get(rules[identity]["upstream_id"])
        if (
            not isinstance(data, dict)
            or not isinstance(data.get("models"), dict)
            or not data["models"]
        ):
            raise CatalogError(f"{identity}: missing or empty upstream models")
        if data.get("id") != rules[identity]["upstream_id"]:
            raise CatalogError(f"{identity}: wrong upstream provider identity")
        for model_id, model in data["models"].items():
            if (
                not isinstance(model_id, str)
                or not model_id.strip()
                or not isinstance(model, dict)
                or model.get("id") != model_id
            ):
                raise CatalogError(
                    f"{identity}/{model_id}: inconsistent or duplicate model identity"
                )
        snapshot = {
            "schema_version": 1,
            "source_url": SOURCE_URL,
            "fetched_at": fetched_at or datetime.now(UTC).isoformat(),
            "content_hash": digest(encode(data)),
            "data": data,
        }
        target = inputs / f"{identity}.snapshot.json"
        if target.exists():
            previous = decode(target.read_bytes())
            if (
                encode(previous.get("data")) == encode(data)
                and previous.get("content_hash") == snapshot["content_hash"]
            ):
                reports.append(f"{identity}: unchanged {previous['fetched_at']}")
                continue
        pending[target] = encode(snapshot)
        reports.append(f"{identity}: fetched {SOURCE_URL}")
    publish(pending)
    return reports


def load_rules(inputs: Path) -> dict[str, Any]:
    """Load one versioned rule document per provider, matching its filename identity."""
    rules: dict[str, Any] = {}
    for path in sorted(inputs.glob("*.rules.json")):
        document = decode(path.read_bytes())
        if type(document.get("schema_version")) is not int or document["schema_version"] != 1:
            raise CatalogError(f"{path.name}: invalid rules schema_version")
        rule = document.get("provider")
        identity = path.name.removesuffix(".rules.json")
        if not isinstance(rule, dict) or rule.get("id") != identity:
            raise CatalogError(f"{path.name}: invalid provider rule identity")
        rules[identity] = rule
    select_providers(rules)
    return rules
