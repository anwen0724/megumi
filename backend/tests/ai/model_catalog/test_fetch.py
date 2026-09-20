"""Fetch snapshots through the public tool, preserving exact upstream data."""

import json

import pytest
from conftest import raw_model, response

from app.ai.scripts.catalog_io import CatalogError


def test_fetch_preserves_raw_fields_precision_and_runtime_outputs(tool):
    body = response(
        openai={"new-model": raw_model(extra={"future": True})}, deepseek={"new-model": raw_model()}
    )
    body = body.replace(b'"input": 1,', b'"input": 0.123456789012345678901,')
    calls = []

    def transport(url, timeout):
        calls.append((url, timeout))
        return body

    tool.fetch(transport=transport, fetched_at="2026-09-20T10:00:00+00:00")
    saved = tool.inputs / "snapshots/openai.json"
    assert saved.exists()
    text = saved.read_text(encoding="utf-8")
    assert "0.123456789012345678901" in text
    data = json.loads(text)
    assert data["data"]["models"]["new-model"]["extra"] == {"future": True}
    assert data["source_url"] == "https://models.dev/api.json"
    assert data["fetched_at"] == "2026-09-20T10:00:00+00:00"
    assert len(calls) == 1 and 0 < calls[0][1] <= 60
    assert not tool.output.exists()


def test_same_source_keeps_snapshot_bytes_and_fetch_date(tool):
    body = response(openai={"new-model": raw_model()}, deepseek={"new-model": raw_model()})
    tool.fetch(transport=lambda *_: body, fetched_at="2026-01-01T00:00:00+00:00")
    before = {p.name: p.read_bytes() for p in (tool.inputs / "snapshots").glob("*.json")}
    tool.fetch(transport=lambda *_: body, fetched_at="2026-09-20T00:00:00+00:00")
    assert before == {p.name: p.read_bytes() for p in (tool.inputs / "snapshots").glob("*.json")}



@pytest.mark.parametrize("bad", ["missing", "empty", "invalid-json", "timeout", "http"])
def test_failed_fetch_preserves_all_selected_snapshots(tool, bad):
    good = response(openai={"new-model": raw_model()}, deepseek={"new-model": raw_model()})
    tool.fetch(transport=lambda *_: good)
    before = {p.name: p.read_bytes() for p in (tool.inputs / "snapshots").glob("*.json")}

    def broken(*_):
        if bad == "timeout":
            raise TimeoutError("timed out")
        if bad == "http":
            from urllib.error import HTTPError

            raise HTTPError("https://models.dev/api.json", 503, "unavailable", None, None)
        if bad == "invalid-json":
            return b"{"
        if bad == "empty":
            return response(openai={}, deepseek={"changed": raw_model("changed")})
        return response(deepseek={"changed": raw_model("changed")})

    with pytest.raises(CatalogError):
        tool.fetch(transport=broken)
    assert before == {p.name: p.read_bytes() for p in (tool.inputs / "snapshots").glob("*.json")}


@pytest.mark.parametrize("identity", ["unknown", "../outside", "CON", "openai/child"])
def test_bad_provider_is_rejected_before_network_or_writes(tool, identity):
    calls = []
    with pytest.raises(CatalogError):
        tool.fetch([identity], transport=lambda *_: calls.append(True))
    assert not calls and not tool.inputs.exists()


def test_fetch_only_selected_provider(tool):
    good = response(openai={"new-model": raw_model()}, deepseek={"new-model": raw_model()})
    tool.fetch(transport=lambda *_: good)
    previous = (tool.inputs / "snapshots/deepseek.json").read_bytes()
    tool.fetch(["openai"], transport=lambda *_: response(openai={"second": raw_model("second")}))
    assert (tool.inputs / "snapshots/deepseek.json").read_bytes() == previous
