"""Maintain provider model catalogs through explicit development operations."""

import re
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from app.ai.scripts.catalog_io import CatalogError, decode, digest, encode

SOURCE_URL = "https://models.dev/api.json"


def download(url: str, timeout: float) -> bytes:
    """Bound network access to the explicit fetch operation."""
    with urlopen(url, timeout=timeout) as response:
        return bytes(response.read())


class CatalogTool:
    """Operate on injected roots without depending on the working directory."""

    def __init__(self, inputs: Path, output: Path, rules: dict[str, Any]) -> None:
        self.inputs = inputs
        self.output = output
        self.rules = rules

    def select(self, providers: list[str] | None = None) -> list[str]:
        """Validate selected identities before any network or filesystem mutation."""
        selected = sorted(set(providers if providers is not None else self.rules))
        for identity in selected:
            if (
                not re.fullmatch(r"[a-z][a-z0-9_-]*", identity)
                or identity in {"con", "prn", "aux", "nul", "manifest"}
                or re.fullmatch(r"(com|lpt)[0-9]", identity)
                or identity not in self.rules
                or self.rules[identity].get("id") != identity
            ):
                raise CatalogError(f"Unknown or unsafe provider: {identity}")
        if not selected:
            raise CatalogError("No providers selected")
        return selected

    def fetch(
        self,
        providers: list[str] | None = None,
        *,
        transport: Callable[[str, float], bytes] = download,
        fetched_at: str | None = None,
    ) -> list[str]:
        """Fetch selected upstream catalogs without touching runtime outputs."""
        selected = self.select(providers)
        try:
            source = decode(transport(SOURCE_URL, 30))
        except OSError as exc:
            raise CatalogError(f"Fetch {SOURCE_URL} failed: {exc}") from exc
        if not isinstance(source, dict):
            raise CatalogError("Upstream root must be an object")
        pending: dict[Path, bytes] = {}
        reports = []
        for identity in selected:
            data = source.get(self.rules[identity]["upstream_id"])
            if (
                not isinstance(data, dict)
                or not isinstance(data.get("models"), dict)
                or not data["models"]
            ):
                raise CatalogError(f"{identity}: missing or empty upstream models")
            snapshot = {
                "schema_version": 1,
                "source_url": SOURCE_URL,
                "fetched_at": fetched_at or datetime.now(UTC).isoformat(),
                "content_hash": digest(encode(data)),
                "data": data,
            }
            target = self.inputs / "snapshots" / f"{identity}.json"
            if target.exists():
                previous = decode(target.read_bytes())
                if previous.get("data") == data:
                    reports.append(f"{identity}: unchanged {previous['fetched_at']}")
                    continue
            pending[target] = encode(snapshot)
            reports.append(f"{identity}: fetched {SOURCE_URL}")
        for target, content in pending.items():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        return reports
