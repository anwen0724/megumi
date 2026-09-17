"""CLI behaviour: argument parsing, exit codes and failure reporting."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from megumi import __version__
from megumi.cli import main


def test_version_flag_prints_the_version(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["--version"])

    assert exit_info.value.code == 0
    assert __version__ in capsys.readouterr().out


def test_a_command_is_required(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main([])

    assert exit_info.value.code != 0
    assert "usage" in capsys.readouterr().err.lower()


def test_unknown_command_is_rejected() -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["fly"])

    assert exit_info.value.code != 0


def test_doctor_reports_the_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEGUMI_HOME", str(tmp_path / "home"))

    exit_code = main(["doctor"])

    assert exit_code == 0


def test_doctor_prints_the_home_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("MEGUMI_HOME", str(tmp_path / "home"))

    main(["doctor"])

    assert str(tmp_path / "home") in capsys.readouterr().out


def test_invalid_configuration_reports_json_and_exit_code(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("MEGUMI_PORT", "not-a-port")

    exit_code = main(["run"])
    payload = json.loads(capsys.readouterr().err.strip().splitlines()[-1])

    assert exit_code == 2
    assert payload["error"]["code"] == "invalid_configuration"


def test_run_starts_the_server_through_the_shared_entry_point(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MEGUMI_HOME", str(tmp_path / "home"))
    started: list[object] = []

    async def fake_serve_app(app: object, on_ready: object = None) -> None:
        started.append(app)

    monkeypatch.setattr("megumi.cli.serve_app", fake_serve_app)

    exit_code = main(["run", "--port", "8421"])

    assert exit_code == 0
    assert len(started) == 1


def test_run_rejects_an_out_of_range_port_argument(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("MEGUMI_HOME", str(tmp_path / "home"))

    exit_code = main(["run", "--port", "70000"])
    payload = json.loads(capsys.readouterr().err.strip().splitlines()[-1])

    assert exit_code == 2
    assert payload["error"]["code"] == "invalid_configuration"


def test_run_surfaces_home_failures_as_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    blocked = tmp_path / "home"
    blocked.write_text("this is a file, not a directory", encoding="utf-8")
    monkeypatch.setenv("MEGUMI_HOME", str(blocked))

    exit_code = main(["run"])
    payload = json.loads(capsys.readouterr().err.strip().splitlines()[-1])

    assert exit_code == 2
    assert payload["error"]["code"] == "home_unavailable"
