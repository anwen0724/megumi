"""Builds the image-model catalogue from the OpenRouter model registry.

OpenRouter is the one image provider this layer talks to, and its registry is a live
endpoint, so the catalogue is generated rather than hand-maintained. A model is included only
when it can produce an image; a model that only accepts or returns text is not an image model
and would only be noise in the catalogue.

Prices arrive per token and are converted to per million tokens, which is the unit the rest of
the layer prices with.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import httpx

__all__ = [
    "OPENROUTER_BASE_URL",
    "fetch_openrouter_image_models",
    "generate_image_models_file",
    "main",
    "parse_openrouter_image_models",
]

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Where the generated catalogue is written, relative to this file.
PACKAGE_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = PACKAGE_ROOT / "providers" / "image_models_generated.py"

# Prices from the registry are per token; the layer prices per million.
_TOKENS_PER_UNIT = 1_000_000


def _modalities(value: Any) -> list[str]:
    """The distinct text and image modalities a registry entry declares, in order."""

    if not isinstance(value, list):
        return []
    seen: list[str] = []
    for entry in value:
        if entry in ("text", "image") and entry not in seen:
            seen.append(entry)
    return seen


def _price(value: Any) -> float:
    """A per-token price as a per-million-token rate, treating anything unreadable as zero."""

    try:
        return float(value) * _TOKENS_PER_UNIT
    except (TypeError, ValueError):
        return 0.0


def parse_openrouter_image_models(payload: Any, strict: bool) -> list[dict[str, Any]]:
    """Turn a registry response into image-model entries.

    A model is kept only when it can return an image. A model that declares no input modality
    is treated as text-in, because the registry leaves the field out rather than repeating the
    obvious default.
    """

    data = payload.get("data") if isinstance(payload, Mapping) else None
    if not isinstance(data, list) or not data:
        if strict:
            raise ValueError("OpenRouter API returned a missing or empty image model list")
        return []

    models: list[dict[str, Any]] = []
    for record in data:
        if not isinstance(record, Mapping):
            continue
        architecture = record.get("architecture")
        architecture_map = architecture if isinstance(architecture, Mapping) else {}
        inputs = _modalities(architecture_map.get("input_modalities"))
        outputs = _modalities(architecture_map.get("output_modalities"))

        if "image" not in outputs:
            continue
        if not inputs:
            inputs = ["text"]

        pricing = record.get("pricing")
        pricing_map = pricing if isinstance(pricing, Mapping) else {}
        models.append(
            {
                "id": record.get("id"),
                "name": record.get("name"),
                "api": "openrouter-images",
                "provider": "openrouter",
                "baseUrl": OPENROUTER_BASE_URL,
                "input": inputs,
                "output": outputs,
                "cost": {
                    "input": _price(pricing_map.get("prompt") or "0"),
                    "output": _price(pricing_map.get("completion") or "0"),
                    "cacheRead": _price(pricing_map.get("input_cache_read") or "0"),
                    "cacheWrite": _price(pricing_map.get("input_cache_write") or "0"),
                },
            },
        )

    if strict and not models:
        raise ValueError("OpenRouter API returned no usable image models")
    return models


async def fetch_openrouter_image_models(strict: bool) -> list[dict[str, Any]]:
    """Read the registry, returning nothing rather than raising when not in strict mode."""

    try:
        print("Fetching image models from OpenRouter API...")
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(
                f"{OPENROUTER_BASE_URL}/models",
                params={"output_modalities": "image"},
            )
        if response.status_code != 200:
            raise ValueError(f"OpenRouter API returned {response.status_code}")
        models = parse_openrouter_image_models(response.json(), strict)
        print(f"Fetched {len(models)} image models from OpenRouter")
        return models
    except BaseException as error:
        print(f"Failed to fetch OpenRouter image models: {error}", file=sys.stderr)
        if strict:
            raise
        return []


def _literal(value: Any) -> str:
    """Render a value as a Python literal, in the same shape the layer's fields use."""

    return repr(value)


def _entry_source(model: Mapping[str, Any]) -> str:
    """One model's generated constructor call."""

    cost = model["cost"]
    return (
        "        ImagesModel(\n"
        f"            id={_literal(model['id'])},\n"
        f"            name={_literal(model['name'])},\n"
        f"            api={_literal(model['api'])},\n"
        f"            provider={_literal(model['provider'])},\n"
        f"            baseUrl={_literal(model['baseUrl'])},\n"
        f"            input={_literal(model['input'])},\n"
        f"            output={_literal(model['output'])},\n"
        "            cost=ModelCost(\n"
        f"                input={cost['input']!r},\n"
        f"                output={cost['output']!r},\n"
        f"                cacheRead={cost['cacheRead']!r},\n"
        f"                cacheWrite={cost['cacheWrite']!r},\n"
        "            ),\n"
        "        )"
    )


def generate_image_models_file(models: list[dict[str, Any]]) -> str:
    """The generated module's source, with models ordered by id so a diff is stable."""

    ordered = sorted(models, key=lambda model: str(model["id"]))
    entries = "".join(
        f"        {_literal(model['id'])}:\n{_entry_source(model)},\n" for model in ordered
    )
    return (
        '"""Image-generation models, generated from the OpenRouter registry.\n'
        "\n"
        "This file is written by scripts/generate_image_models.py; edit that instead of this.\n"
        '"""\n'
        "\n"
        "from __future__ import annotations\n"
        "\n"
        "from app.ai.types import ImagesModel, ModelCost\n"
        "\n"
        "__all__ = [\"IMAGE_MODELS\"]\n"
        "\n"
        "IMAGE_MODELS: dict[str, dict[str, ImagesModel]] = {\n"
        '    "openrouter": {\n'
        f"{entries}"
        "    },\n"
        "}\n"
    )


def _read_args(argv: list[str]) -> argparse.Namespace:
    """Parse the arguments, rejecting anything the generator does not understand."""

    parser = argparse.ArgumentParser(description="Generate the image-model catalogue.")
    parser.add_argument("--strict", action="store_true", help="fail instead of writing nothing")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Fetch the registry and write the catalogue."""

    args = _read_args(sys.argv[1:] if argv is None else argv)
    import asyncio

    models = asyncio.run(fetch_openrouter_image_models(args.strict))
    OUTPUT_PATH.write_text(generate_image_models_file(models), encoding="utf-8")
    print(f"Generated {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
