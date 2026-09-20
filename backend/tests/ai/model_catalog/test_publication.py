"""Filesystem failures must not masquerade as successful catalog updates."""

import os

import pytest
from conftest import raw_model, response
from test_commands import seed

from app.ai.catalog_generation import CatalogError


@pytest.mark.parametrize("operation", ["fetch", "generate"])
def test_replace_failure_restores_every_old_file(tool, monkeypatch, operation):
    seed(tool)
    tool.generate(write=True)
    root = tool.inputs if operation == "fetch" else tool.output
    before = {p.name: p.read_bytes() for p in root.iterdir()}
    replacement = response(openai={"next": raw_model("next")}, deepseek={"next": raw_model("next")})
    if operation == "generate":
        tool.fetch(transport=lambda *_: replacement)
    real_replace = os.replace
    count = 0

    def fail_second(source, target):
        nonlocal count
        count += 1
        if count == 2:
            raise OSError("simulated replacement failure")
        return real_replace(source, target)

    monkeypatch.setattr(os, "replace", fail_second)
    with pytest.raises(CatalogError, match="restored"):
        if operation == "fetch":
            tool.fetch(transport=lambda *_: replacement)
        else:
            tool.generate(write=True)
    assert before == {p.name: p.read_bytes() for p in root.iterdir()}


def test_rollback_failure_reports_affected_file_and_preserves_backup(tool, monkeypatch):
    seed(tool)
    tool.generate(write=True)
    before = (tool.output / "deepseek.json").read_bytes()
    tool.fetch(
        transport=lambda *_: response(
            openai={"next": raw_model("next")}, deepseek={"next": raw_model("next")}
        )
    )
    real_replace = os.replace
    count = 0

    def fail_publication_and_recovery(source, target):
        nonlocal count
        count += 1
        if count >= 2:
            raise OSError("disk unavailable")
        real_replace(source, target)

    monkeypatch.setattr(os, "replace", fail_publication_and_recovery)
    with pytest.raises(CatalogError, match=r"rollback failed.*deepseek.json.*backups:") as error:
        tool.generate(write=True)
    assert "old files restored" not in str(error.value)
    backups = list(tool.output.glob(".catalog-*/*.bak"))
    assert backups and any(p.read_bytes() == before for p in backups)


def test_invalid_second_provider_never_publishes_first(tool):
    seed(tool)
    tool.generate(write=True)
    before = {p.name: p.read_bytes() for p in tool.output.iterdir()}
    tool.fetch(
        transport=lambda *_: response(
            deepseek={"next": raw_model("next")},
            openai={"broken": raw_model("broken", limit={"context": -1, "output": 5})},
        )
    )
    with pytest.raises(CatalogError, match="openai/broken"):
        tool.generate(write=True)
    assert before == {p.name: p.read_bytes() for p in tool.output.iterdir()}


@pytest.mark.parametrize(
    "field,value,diagnostic",
    [
        ("sampling_params", [], "sampling_params"),
        ("compat", {"supports_strict_mode": "yes"}, "compat"),
        ("compat", {"unimplemented_option": True}, "compat"),
    ],
)
def test_invalid_extended_metadata_reports_field_and_never_publishes(
    tool, field, value, diagnostic
):
    seed(tool)
    tool.generate(write=True)
    before = {p.name: p.read_bytes() for p in tool.output.iterdir()}
    tool.rules["openai"][field] = value
    with pytest.raises(CatalogError, match=f"openai/new-model.*{diagnostic}"):
        tool.generate(write=True)
    assert before == {p.name: p.read_bytes() for p in tool.output.iterdir()}
