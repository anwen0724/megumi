"""Maintain provider model catalogs through explicit development operations."""

import argparse
import re
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from app.ai.scripts.catalog_io import CatalogError, decode, digest, encode, publish
from app.ai.scripts.catalog_transform import fields, generate_catalog

SOURCE_URL = "https://models.dev/api.json"


def download(url: str, timeout: float) -> bytes:
    """Bound network access to the explicit fetch operation."""
    request = Request(
        url, headers={"User-Agent": "Megumi-ModelCatalog/1.0", "Accept": "application/json"}
    )
    with urlopen(request, timeout=timeout) as response:
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
            if data.get("id") != self.rules[identity]["upstream_id"]:
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
            target = self.inputs / "snapshots" / f"{identity}.json"
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

    def generate(
        self, providers: list[str] | None = None, *, write: bool = False, check: bool = False
    ) -> tuple[int, list[str]]:
        """Build offline, report differences and optionally publish selected results."""
        selected = self.select(providers)
        if write and check:
            raise CatalogError("check cannot write")
        manifest_path = self.output / "manifest.json"
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
        report: list[str] = []
        changed = False
        for identity in selected:
            raw_snapshot = (self.inputs / "snapshots" / f"{identity}.json").read_bytes()
            snapshot = decode(raw_snapshot)
            models, traces, discovery = generate_catalog(snapshot, self.rules[identity])
            report.append(
                f"{identity}: source {snapshot['source_url']} fetched {snapshot['fetched_at']}"
            )
            report.extend(f"{identity}: {item}" for item in discovery)
            candidate = encode(models)
            target = self.output / f"{identity}.json"
            previous = target.read_bytes() if target.exists() else None
            entry = {
                "snapshot_hash": digest(raw_snapshot),
                "rules_hash": digest(encode(self.rules[identity])),
                "generator_hash": generator_hash(),
                "output_hash": digest(candidate),
                "source_url": snapshot["source_url"],
                "fetched_at": snapshot["fetched_at"],
                "models": traces,
            }
            if previous != candidate:
                changed = True
                report.extend(differences(identity, previous, models))
            if encode(old_manifest["providers"].get(identity)) != encode(entry):
                changed = True
                report.append(f"{identity}: manifest differs")
            manifest["providers"][identity] = entry
            pending[target] = candidate
        if providers is None and check:
            actual = {path.stem for path in self.output.glob("*.json")} - {"manifest"}
            expected = set(self.rules)
            if actual != expected or set(old_manifest["providers"]) != expected:
                changed = True
                report.append(
                    f"catalog collection differs: expected {sorted(expected)}, "
                    f"files {sorted(actual)}, manifest {sorted(old_manifest['providers'])}"
                )
        pending[manifest_path] = encode(manifest)
        if (
            providers is None
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


def generator_hash() -> str:
    """Fingerprint conversion code and runtime contracts, independent of line endings."""
    folder = Path(__file__).resolve().parent
    sources = sorted(folder.glob("*.py")) + [
        folder.parent / name for name in ("catalog.py", "model.py", "provider.py")
    ]
    return digest(
        b"".join(
            path.name.encode() + b"\0" + path.read_bytes().replace(b"\r\n", b"\n")
            for path in sources
        )
    )


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


def main(argv: list[str] | None = None, *, tool: CatalogTool | None = None) -> int:
    """Run one explicit maintenance operation and return its documented exit code."""
    parser = argparse.ArgumentParser(description="Maintain offline provider model catalogs")
    commands = parser.add_subparsers(dest="operation", required=True)
    for operation in ("fetch", "generate", "check"):
        command = commands.add_parser(operation)
        command.add_argument("--provider", action="append", dest="providers")
        if operation == "generate":
            command.add_argument("--write", action="store_true")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code or 0)
    try:
        active = tool if tool is not None else default_tool()
        if args.operation == "fetch":
            report = active.fetch(args.providers)
            status = 0
        else:
            status, report = active.generate(
                args.providers, write=getattr(args, "write", False), check=args.operation == "check"
            )
        for line in report:
            print(line)
        return status
    except (CatalogError, OSError, KeyError, TypeError, AttributeError) as exc:
        print(f"Catalog error: {exc}", file=sys.stderr)
        return 2


def default_tool() -> CatalogTool:
    """Resolve package-owned inputs, never the caller's current directory."""
    folder = Path(__file__).resolve().parent
    inputs = folder / "catalog_inputs"
    rules = decode((inputs / "rules.json").read_bytes())
    if rules.get("schema_version") != 1 or not isinstance(rules.get("providers"), dict):
        raise CatalogError("Invalid rules document")
    return CatalogTool(inputs, folder.parent / "providers" / "data", rules["providers"])


if __name__ == "__main__":
    raise SystemExit(main())
