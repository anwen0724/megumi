"""Exact JSON and source validation shared by development catalog operations."""

import hashlib
import json
import os
import shutil
import tempfile
from decimal import Decimal
from pathlib import Path
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


def publish(pending: dict[Path, bytes]) -> None:
    """Stage every file and backup first; recover ordinary replacement failures."""
    changes = {
        path: value
        for path, value in pending.items()
        if not path.exists() or path.read_bytes() != value
    }
    if not changes:
        return
    parents = {path.parent.resolve() for path in changes}
    if len(parents) != 1:
        raise CatalogError("Publication requires one destination directory")
    parent = parents.pop()
    parent.mkdir(parents=True, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix=".catalog-", dir=parent))
    records: list[tuple[Path, Path, Path | None]] = []
    installed: list[tuple[Path, Path | None]] = []
    preserve = False
    try:
        for index, (target, content) in enumerate(changes.items()):
            staged = folder / f"{index}.new"
            staged.write_bytes(content)
            backup = folder / f"{index}.bak" if target.exists() else None
            if backup is not None:
                backup.write_bytes(target.read_bytes())
            records.append((target, staged, backup))
        for target, staged, backup in records:
            os.replace(staged, target)
            installed.append((target, backup))
    except OSError as exc:
        failures = []
        for target, backup in reversed(installed):
            try:
                if backup is None:
                    target.unlink()
                else:
                    restore = backup.with_suffix(".restore")
                    restore.write_bytes(backup.read_bytes())
                    os.replace(restore, target)
            except OSError:
                failures.append(str(target))
        if failures:
            preserve = True
            raise CatalogError(
                f"Publication failed: {exc}; rollback failed for {failures}; backups: {folder}"
            ) from exc
        raise CatalogError(f"Publication failed: {exc}; old files restored") from exc
    finally:
        if not preserve:
            # Only this call's newly created directory can be cleaned up.
            if folder.resolve().parent != parent:
                raise CatalogError(f"Unexpected staging path: {folder}")
            shutil.rmtree(folder)
