"""Small independent source fixtures for catalog maintenance behavior."""

import json

import pytest

from app.ai.catalog_generation.generate import CatalogTool


def raw_model(identity="new-model", **changes):
    model = {
        "id": identity,
        "name": "New model",
        "tool_call": True,
        "reasoning": False,
        "temperature": True,
        "modalities": {"input": ["text"], "output": ["text"]},
        "limit": {"context": 8192, "output": 2048},
        "cost": {"input": 1, "output": 2},
    }
    model.update(changes)
    return model


def rule(identity):
    return {
        "id": identity,
        "upstream_id": identity,
        "name": identity,
        "api": "openai-responses",
        "base_url": "https://example.test/v1",
        "env_var": identity.upper() + "_API_KEY",
        "currency": "USD",
        "source_currency": "USD",
        "unit_tokens": 1000000,
        "reasoning_map": {"none": "off", "low": "low", "high": "high"},
        "excluded": [],
        "supplements": [],
        "patches": [],
        "reviews": [],
    }


@pytest.fixture
def tool(tmp_path):
    return CatalogTool(
        tmp_path / "inputs",
        tmp_path / "outputs",
        {name: rule(name) for name in ("openai", "deepseek")},
    )


def response(**providers):
    return json.dumps(
        {identity: {"id": identity, "models": models} for identity, models in providers.items()}
    ).encode()
