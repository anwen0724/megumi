"""Exact JSON and source validation shared by development catalog operations."""

import hashlib
import json
from decimal import Decimal
from typing import Any


class CatalogError(ValueError):
    """A maintenance failure that must not publish a partial catalog."""


def decode(data: str | bytes) -> Any:
    """Read decimal numbers exactly and reject ambiguous duplicate JSON keys."""

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise CatalogError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result

    def invalid(value: str) -> None:
        raise CatalogError(f"Nonfinite JSON number: {value}")

    try:
        return json.loads(
            data, parse_float=Decimal, object_pairs_hook=pairs, parse_constant=invalid
        )
    except (ValueError, UnicodeError) as exc:
        raise CatalogError(f"Invalid JSON: {exc}") from exc


def encode(value: Any) -> bytes:
    """Canonical UTF-8 JSON; decimal source numbers remain numbers without float loss."""

    def render(item: Any) -> str:
        if isinstance(item, Decimal):
            if not item.is_finite():
                raise CatalogError("Nonfinite decimal")
            return str(item)
        if isinstance(item, dict):
            return (
                "{"
                + ", ".join(
                    json.dumps(key, ensure_ascii=False) + ": " + render(item[key])
                    for key in sorted(item)
                )
                + "}"
            )
        if isinstance(item, (list, tuple)):
            return "[" + ", ".join(render(child) for child in item) + "]"
        return json.dumps(item, ensure_ascii=False, allow_nan=False)

    return (render(value) + "\n").encode("utf-8")


def digest(data: bytes) -> str:
    """Content address for stable source and artifact identity."""
    return hashlib.sha256(data).hexdigest()
