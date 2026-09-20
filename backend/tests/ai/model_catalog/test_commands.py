"""Preview, publication and check expose the same deterministic candidate."""

from conftest import raw_model, response

from app.ai.scripts.catalog_io import decode


def seed(tool, models=None):
    data = models or {"new-model": raw_model()}
    tool.fetch(
        transport=lambda *_: response(openai=data, deepseek=data),
        fetched_at="2026-09-20T00:00:00+00:00",
    )


def test_preview_write_and_check_share_deterministic_results(tool):
    seed(tool)
    status, report = tool.generate()
    assert status == 0 and not tool.output.exists()
    assert any("added" in item and "new-model" in item for item in report)
    tool.generate(write=True)
    saved = {p.name: p.read_bytes() for p in tool.output.glob("*.json")}
    assert set(saved) == {"openai.json", "deepseek.json", "manifest.json"}
    manifest = decode(saved["manifest.json"])
    assert manifest["providers"]["openai"]["models"]["new-model"]["fields"]
    assert tool.generate(check=True)[0] == 0
    tool.generate(write=True)
    assert saved == {p.name: p.read_bytes() for p in tool.output.glob("*.json")}
    (tool.output / "openai.json").write_bytes(b"[]\n")
    assert tool.generate(check=True)[0] == 1
    assert (tool.output / "openai.json").read_bytes() == b"[]\n"


def test_single_provider_update_preserves_other_files_and_manifest_entry(tool):
    seed(tool)
    tool.generate(write=True)
    other = (tool.output / "deepseek.json").read_bytes()
    other_entry = decode((tool.output / "manifest.json").read_bytes())["providers"]["deepseek"]
    tool.fetch(["openai"], transport=lambda *_: response(openai={"next": raw_model("next")}))
    _, report = tool.generate(["openai"])
    assert any("new-model" in item and "removed" in item for item in report)
    assert (tool.output / "deepseek.json").read_bytes() == other
    tool.generate(["openai"], write=True)
    assert (tool.output / "deepseek.json").read_bytes() == other
    assert (
        decode((tool.output / "manifest.json").read_bytes())["providers"]["deepseek"] == other_entry
    )
    assert [m["id"] for m in decode((tool.output / "openai.json").read_bytes())] == ["next"]


def test_check_detects_manifest_tampering_and_extra_catalog(tool):
    seed(tool)
    tool.generate(write=True)
    manifest = tool.output / "manifest.json"
    data = decode(manifest.read_bytes())
    data["providers"]["openai"]["source_url"] = "https://example.test/wrong"
    from app.ai.scripts.catalog_io import encode

    manifest.write_bytes(encode(data))
    assert tool.generate(check=True)[0] == 1
    tool.generate(write=True)
    (tool.output / "unregistered.json").write_bytes(b"[]\n")
    assert tool.generate(check=True)[0] == 1
    assert tool.generate(["openai"], check=True)[0] == 0
