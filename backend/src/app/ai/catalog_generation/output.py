"""Compare, serialize and publish model catalogs with recoverable file replacement."""

import hashlib
import json
import os
import shutil
import tempfile
from decimal import Decimal
from pathlib import Path
from typing import Any

from app.ai.catalog_generation import CatalogError


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


def differences(identity: str, previous: bytes | None, models: list[dict[str, Any]]) -> list[str]:
    """Describe model additions, removals and changed fields without using old data as input."""
    try:
        entries = decode(previous) if previous is not None else []
        old = {item["id"]: item for item in entries}
    except (ValueError, KeyError, TypeError):
        return [f"{identity}: saved catalog is invalid; replacing with validated candidate"]
    new = {item["id"]: item for item in models}
    report = [f"{identity}/{key}: added" for key in sorted(new.keys() - old.keys())]
    report.extend(f"{identity}/{key}: removed" for key in sorted(old.keys() - new.keys()))
    for key in sorted(new.keys() & old.keys()):
        before, after = fields(old[key]), fields(new[key])
        for field in sorted(before.keys() | after.keys()):
            if encode(before.get(field)) != encode(after.get(field)) or (field in before) != (
                field in after
            ):
                report.append(
                    f"{identity}/{key}.{field}: {before.get(field, '<missing>')!r} -> "
                    f"{after.get(field, '<missing>')!r}"
                )
    if not report:
        report.append(f"{identity}: JSON representation differs")
    return report


def write_or_check(
    output: Path,
    candidates: dict[str, dict[str, Any]],
    registered: set[str],
    *,
    full: bool,
    write: bool,
    check: bool,
    report: list[str],
) -> tuple[int, list[str]]:
    """Compare validated candidates, preserving unselected provider manifest entries."""
    manifest_path = output / "manifest.json"
    old_manifest: dict[str, Any] = (
        decode(manifest_path.read_bytes())
        if manifest_path.exists()
        else {"schema_version": 1, "providers": {}}
    )
    manifest: dict[str, Any] = {
        "schema_version": 1,
        "providers": dict(old_manifest["providers"]),
    }
    pending: dict[Path, bytes] = {}
    changed = False
    for identity, candidate in candidates.items():
        target = output / f"{identity}.json"
        previous = target.read_bytes() if target.exists() else None
        content = candidate["content"]
        entry = candidate["manifest"]
        if previous != content:
            changed = True
            report.extend(differences(identity, previous, candidate["models"]))
        if encode(old_manifest["providers"].get(identity)) != encode(entry):
            changed = True
            report.append(f"{identity}: manifest differs")
        manifest["providers"][identity] = entry
        pending[target] = content
    if full and check:
        actual = {path.stem for path in output.glob("*.json")} - {"manifest"}
        if actual != registered or set(old_manifest["providers"]) != registered:
            changed = True
            report.append(
                f"catalog collection differs: expected {sorted(registered)}, "
                f"files {sorted(actual)}, manifest {sorted(old_manifest['providers'])}"
            )
    pending[manifest_path] = encode(manifest)
    if (
        full
        and check
        and manifest_path.exists()
        and manifest_path.read_bytes() != pending[manifest_path]
    ):
        changed = True
        report.append("manifest representation differs")
    if write:
        publish(pending)
    report.append("different" if changed else "consistent")
    return (1 if check and changed else 0), report
