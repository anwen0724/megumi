"""The structure of the generated model catalogue, and how it is checked.

A provider's catalogue is written as one JSON file per provider, holding the models grouped
by the api that streams them. Beside those files sits a manifest naming the schema version,
the moment of generation, a hash of the whole structure, and a hash per file. The manifest is
what makes a stale or hand-edited catalogue detectable: a file whose hash does not match, or
a model that moved between api groups, is reported instead of silently shipped.

Both the generator and the build-time check use this module, so they cannot disagree about
what a valid catalogue is.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

__all__ = [
    "MODEL_DATA_MANIFEST_FILE",
    "MODEL_DATA_SCHEMA_VERSION",
    "ModelDataManifest",
    "ModelDataStructure",
    "assertExactModelIds",
    "createModelDataManifest",
    "modelDataStructureHash",
    "readModelDataProviderIds",
    "readModelDataStructure",
    "validateGeneratedModelData",
    "validateModelDataDirectory",
]

MODEL_DATA_SCHEMA_VERSION = 3
MODEL_DATA_MANIFEST_FILE = ".manifest.json"

# One provider's models, mapped from model id to the api that streams it.
type ModelDataStructure = dict[str, dict[str, str]]

# The import line the aggregator uses for each provider's generated shard.
_MODEL_DATA_IMPORT = re.compile(
    r"^import \{ [A-Z][A-Z0-9_]*_MODELS \} from ""\./providers/([^""/]+)\.models\.ts"";$"
    r"|^from app\.ai\.providers\.([a-z0-9_]+)_models import [A-Z][A-Z0-9_]*_MODELS$",
    re.MULTILINE,
)

# The fields every generated model must carry, with the type each has to hold.
_COST_FIELDS = ("input", "output", "cacheRead", "cacheWrite")


@dataclass(slots=True)
class ModelDataManifest:
    """What was generated, and what it hashed to."""

    schemaVersion: int
    generatedAt: str
    structureHash: str
    files: dict[str, str] = field(default_factory=dict)


def _sha256(value: str) -> str:
    """The content hash used for both the structure and each file."""

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _sorted_record(entries: Mapping[str, Any] | Iterable[tuple[str, Any]]) -> dict[str, Any]:
    """A mapping with its keys in a fixed order, so a hash does not depend on insertion."""

    items = entries.items() if isinstance(entries, Mapping) else entries
    return {key: value for key, value in sorted(items, key=lambda item: item[0])}


def _same_strings(left: list[str], right: list[str]) -> bool:
    """Whether two sorted lists hold the same values in the same order."""

    return left == right


def _describe_set_difference(expected: list[str], actual: list[str]) -> str:
    """A readable account of what one list has that the other lacks."""

    expected_set = set(expected)
    actual_set = set(actual)
    missing = [value for value in expected if value not in actual_set]
    extra = [value for value in actual if value not in expected_set]
    parts: list[str] = []
    if missing:
        parts.append(f"missing: {', '.join(missing)}")
    if extra:
        parts.append(f"extra: {', '.join(extra)}")
    return "; ".join(parts)


def assertExactModelIds(
    label: str,
    expected: Iterable[str],
    actual: Iterable[str],
) -> None:
    """Fail when the model ids a catalogue claims and the ones it holds differ."""

    expected_ids = sorted(set(expected))
    actual_ids = sorted(set(actual))
    if _same_strings(expected_ids, actual_ids):
        return
    raise ValueError(
        f"{label} model IDs do not match "
        f"({_describe_set_difference(expected_ids, actual_ids)})",
    )


def _is_record(value: Any) -> bool:
    """Whether ``value`` is a JSON object rather than an array or a scalar."""

    return isinstance(value, dict)


def _read_json_object(path: Path, description: str, errors: list[str]) -> dict[str, Any] | None:
    """Read a JSON object, recording a readable reason when it is not one."""

    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        errors.append(f"{description} is not valid JSON: {error}")
        return None
    if not isinstance(parsed, dict):
        errors.append(f"{description} must contain a JSON object")
        return None
    return parsed


def _read_provider_structure(path: Path, provider_id: str) -> dict[str, str]:
    """One provider's data file as a model-id to api mapping."""

    errors: list[str] = []
    groups = _read_json_object(path, f"{provider_id}.json", errors)
    if groups is None:
        raise ValueError("\n".join(errors))

    models: dict[str, str] = {}
    for api, value in groups.items():
        if not _is_record(value):
            raise ValueError(f"{path} API group {api!r} must be an object")
        for model_id in value:
            if model_id in models:
                raise ValueError(f"{path} contains model {model_id} in more than one API group")
            models[model_id] = api
    if not models:
        raise ValueError(f"{path} contains no generated model data")
    return _sorted_record(models)


def _shard_name(provider_id: str) -> str:
    """The generated shard filename for one provider."""

    return f"{provider_id}_models.py"


def _is_shard(name: str) -> bool:
    """Whether a directory entry is a generated provider shard."""

    return name.endswith("_models.py") and name != "builtins.py"


def _providers_dir(package_root: Path) -> Path:
    """Where the provider shards live."""

    return package_root / "providers"


def _data_dir(package_root: Path) -> Path:
    """Where the generated data files live."""

    return _providers_dir(package_root) / "data"


def readModelDataProviderIds(package_root: Path) -> list[str]:
    """The providers the aggregator names, read from the aggregator itself.

    The aggregator is the one file a reader sees first, so the provider list has to come from
    it rather than from a directory listing that could contain a stale shard.
    """

    aggregator_path = package_root / "providers" / "models_generated.py"
    aggregator = aggregator_path.read_text(encoding="utf-8")
    provider_ids = sorted(match.group(1) for match in _MODEL_DATA_IMPORT.finditer(aggregator))
    if not provider_ids:
        raise ValueError(f"No generated provider imports found in {aggregator_path}")
    if len(set(provider_ids)) != len(provider_ids):
        raise ValueError(
            f"Generated model aggregator contains duplicate provider imports: {aggregator_path}",
        )
    return provider_ids


def readModelDataStructure(package_root: Path) -> ModelDataStructure:
    """Every provider's catalogue structure, checked against the shards beside it."""

    providers_dir = _providers_dir(package_root)
    provider_ids = readModelDataProviderIds(package_root)
    expected_shards = sorted(_shard_name(provider_id) for provider_id in provider_ids)
    actual_shards = sorted(
        entry.name for entry in providers_dir.iterdir() if _is_shard(entry.name)
    )
    if not _same_strings(expected_shards, actual_shards):
        raise ValueError(
            "Generated model aggregator and provider shards do not match "
            f"({_describe_set_difference(expected_shards, actual_shards)})",
        )

    return _sorted_record(
        (
            provider_id,
            _read_provider_structure(
                _data_dir(package_root) / f"{provider_id}.json",
                provider_id,
            ),
        )
        for provider_id in provider_ids
    )


def modelDataStructureHash(structure: ModelDataStructure) -> str:
    """A hash of the whole catalogue, independent of key order."""

    normalized = _sorted_record(
        (provider_id, _sorted_record(models)) for provider_id, models in structure.items()
    )
    return _sha256(json.dumps(normalized))


def createModelDataManifest(
    structure: ModelDataStructure,
    file_contents: Mapping[str, str],
    generated_at: str,
) -> ModelDataManifest:
    """Describe a freshly generated catalogue."""

    return ModelDataManifest(
        schemaVersion=MODEL_DATA_SCHEMA_VERSION,
        generatedAt=generated_at,
        structureHash=modelDataStructureHash(structure),
        files=_sorted_record(
            (filename, _sha256(content)) for filename, content in file_contents.items()
        ),
    )


def _validate_model_value(
    value: Any,
    provider_id: str,
    model_id: str,
    expected_api: str,
    errors: list[str],
) -> None:
    """Check one model entry, recording every reason it is unusable."""

    label = f"{provider_id}/{model_id}"
    if not _is_record(value):
        errors.append(f"{label} must be an object")
        return
    if value.get("id") != model_id:
        errors.append(f"{label} has id {value.get('id')!r}, expected {model_id!r}")
    if value.get("provider") != provider_id:
        errors.append(f"{label} has provider {value.get('provider')!r}, expected {provider_id!r}")
    if value.get("api") != expected_api:
        errors.append(f"{label} has api {value.get('api')!r}, expected {expected_api!r}")
    if not isinstance(value.get("name"), str) or not value["name"]:
        errors.append(f"{label} has no model name")
    if not isinstance(value.get("baseUrl"), str):
        errors.append(f"{label} has no baseUrl string")
    if not isinstance(value.get("reasoning"), bool):
        errors.append(f"{label} has no reasoning boolean")

    modalities = value.get("input")
    if (
        not isinstance(modalities, list)
        or not modalities
        or any(entry not in ("text", "image") for entry in modalities)
    ):
        errors.append(f"{label} has invalid input modalities")

    context_window = value.get("contextWindow")
    if not isinstance(context_window, (int, float)) or context_window <= 0:
        errors.append(f"{label} has invalid contextWindow")
    max_tokens = value.get("maxTokens")
    if not isinstance(max_tokens, (int, float)) or max_tokens <= 0:
        errors.append(f"{label} has invalid maxTokens")

    cost = value.get("cost")
    if not _is_record(cost):
        errors.append(f"{label} has invalid cost metadata")
    else:
        for field_name in _COST_FIELDS:
            rate = cost.get(field_name)
            if not isinstance(rate, (int, float)):
                errors.append(f"{label} has invalid cost.{field_name}")


def _raise_validation_errors(errors: list[str]) -> None:
    """Report the first errors, and say how many more there were."""

    visible = errors[:30]
    suffix = f"\n  ... and {len(errors) - len(visible)} more" if len(errors) > len(visible) else ""
    detail = "\n".join(f"  - {error}" for error in visible)
    raise ValueError(f"Invalid generated model data:\n{detail}{suffix}")


def validateModelDataDirectory(
    structure: ModelDataStructure,
    data_dir: Path,
) -> None:
    """Check the generated files against the structure they claim to hold."""

    if not data_dir.is_dir():
        raise ValueError(f"Generated model data directory does not exist: {data_dir}")

    errors: list[str] = []
    expected_files = sorted(f"{provider_id}.json" for provider_id in structure)
    actual_files = sorted(
        entry.name
        for entry in data_dir.iterdir()
        if entry.name.endswith(".json") and entry.name != MODEL_DATA_MANIFEST_FILE
    )
    if not _same_strings(expected_files, actual_files):
        errors.append(
            "provider data files do not match the generated catalog "
            f"({_describe_set_difference(expected_files, actual_files)})",
        )

    manifest_path = data_dir / MODEL_DATA_MANIFEST_FILE
    manifest = _read_json_object(manifest_path, "model data manifest", errors)
    if manifest is not None:
        if manifest.get("schemaVersion") != MODEL_DATA_SCHEMA_VERSION:
            errors.append(
                f"model data schema is {manifest.get('schemaVersion')!r}, "
                f"expected {MODEL_DATA_SCHEMA_VERSION}",
            )
        generated_at = manifest.get("generatedAt")
        if not isinstance(generated_at, str):
            errors.append("model data manifest has an invalid generation timestamp")
        expected_hash = modelDataStructureHash(structure)
        if manifest.get("structureHash") != expected_hash:
            errors.append("model data generation stamp does not match the generated catalog")

    manifest_files_value = manifest.get("files") if manifest is not None else None
    manifest_files = manifest_files_value if _is_record(manifest_files_value) else None
    if manifest_files is None:
        errors.append("model data manifest has no file hashes")
    elif not _same_strings(expected_files, sorted(manifest_files)):
        errors.append(
            "manifest file hashes do not match provider data files "
            f"({_describe_set_difference(expected_files, sorted(manifest_files))})",
        )

    for provider_id, expected_models in structure.items():
        filename = f"{provider_id}.json"
        path = data_dir / filename
        if not path.exists():
            continue
        content = path.read_text(encoding="utf-8")
        if manifest_files is not None and manifest_files.get(filename) != _sha256(content):
            errors.append(f"{filename} does not match its manifest hash")

        groups = _read_json_object(path, filename, errors)
        if groups is None:
            continue

        actual_models: dict[str, str] = {}
        for api, value in groups.items():
            if not _is_record(value):
                errors.append(f"{filename} API group {api!r} must be an object")
                continue
            for model_id, model in value.items():
                if model_id in actual_models:
                    errors.append(f"{provider_id}/{model_id} appears in more than one API group")
                    continue
                actual_models[model_id] = api
                _validate_model_value(model, provider_id, model_id, api, errors)

        expected_ids = sorted(expected_models)
        actual_ids = sorted(actual_models)
        if not _same_strings(expected_ids, actual_ids):
            errors.append(
                f"{filename} model IDs do not match the generated catalog "
                f"({_describe_set_difference(expected_ids, actual_ids)})",
            )
        for model_id, expected_api in expected_models.items():
            actual_api = actual_models.get(model_id)
            if actual_api is not None and actual_api != expected_api:
                errors.append(
                    f"{provider_id}/{model_id} is grouped under API {actual_api!r}, "
                    f"expected {expected_api!r}",
                )

    if errors:
        _raise_validation_errors(errors)


def validateGeneratedModelData(package_root: Path) -> None:
    """Check that the generated catalogue on disk matches what the aggregator claims."""

    structure = readModelDataStructure(package_root)
    validateModelDataDirectory(structure, _data_dir(package_root))
