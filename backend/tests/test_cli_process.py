"""End-to-end process check: start the backend as a real process, then stop it.

This is the same command a developer runs by hand, so it also protects the parts
that a `TestClient` cannot: argument parsing, real socket binding, readiness
logging, graceful shutdown and the exit code. Child output goes to a file instead
of a pipe so the test also works in environments that forbid piped stdio.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

START_TIMEOUT_SECONDS = 45.0
STOP_TIMEOUT_SECONDS = 20.0
POLL_INTERVAL_SECONDS = 0.1
WINDOWS_FORCE_KILL_EXIT_CODES = {1}


def test_backend_process_starts_answers_health_and_stops(tmp_path: Path) -> None:
    home = tmp_path / "home"
    log_path = tmp_path / "console.log"
    process = _start_backend(home, log_path)
    try:
        port = _wait_for_port(process, log_path)
        body = _get_health(port)

        assert body["status"] == "ok"
        assert body["home"] == str(home.resolve())
    finally:
        exit_code = _stop_backend(process, log_path)

    assert exit_code in ({0} | WINDOWS_FORCE_KILL_EXIT_CODES), _tail(log_path)
    assert (home / "logs" / "backend.jsonl").is_file()


def test_startup_failure_exits_non_zero_and_explains_itself(tmp_path: Path) -> None:
    blocked_home = tmp_path / "blocked"
    blocked_home.write_text("this is a file, not a directory", encoding="utf-8")
    log_path = tmp_path / "console.log"

    process = _start_backend(blocked_home, log_path)
    exit_code = process.wait(timeout=STOP_TIMEOUT_SECONDS)

    assert exit_code == 2
    records = _json_lines(log_path)
    assert any(
        record.get("error", {}).get("code") == "home_unavailable"
        for record in records
        if isinstance(record.get("error"), dict)
    ), _tail(log_path)


def test_doctor_runs_without_starting_a_server(tmp_path: Path) -> None:
    log_path = tmp_path / "doctor.log"
    with log_path.open("w", encoding="utf-8") as sink:
        completed = subprocess.run(
            [sys.executable, "-m", "megumi", "doctor"],
            env=_child_environment(tmp_path / "home"),
            stdout=sink,
            stderr=subprocess.STDOUT,
            check=False,
            timeout=START_TIMEOUT_SECONDS,
        )

    assert completed.returncode == 0
    assert "home" in log_path.read_text(encoding="utf-8")


def _start_backend(home: Path, log_path: Path) -> subprocess.Popen[bytes]:
    sink = log_path.open("wb")
    try:
        return subprocess.Popen(
            [sys.executable, "-m", "megumi", "run", "--port", "0"],
            env=_child_environment(home),
            stdout=sink,
            stderr=subprocess.STDOUT,
        )
    finally:
        sink.close()


def _child_environment(home: Path) -> dict[str, str]:
    environment = dict(os.environ)
    environment["MEGUMI_HOME"] = str(home)
    environment["MEGUMI_LOG_FORMAT"] = "console"
    environment["PYTHONIOENCODING"] = "utf-8"
    environment["PYTHONUNBUFFERED"] = "1"
    return environment


def _wait_for_port(process: subprocess.Popen[bytes], log_path: Path) -> int:
    deadline = time.monotonic() + START_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        for record in _json_lines(log_path):
            if record.get("message") == "server.listening" and "port" in record:
                return int(record["port"])
        if process.poll() is not None:
            raise AssertionError(f"backend exited early with {process.returncode}\n{_tail(log_path)}")
        time.sleep(POLL_INTERVAL_SECONDS)
    raise AssertionError(f"backend did not report readiness\n{_tail(log_path)}")


def _get_health(port: int) -> dict[str, object]:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=10) as response:
        assert response.status == 200
        payload = json.loads(response.read().decode("utf-8"))
    assert isinstance(payload, dict)
    return payload


def _stop_backend(process: subprocess.Popen[bytes], log_path: Path) -> int:
    if process.poll() is not None:
        return int(process.returncode or 0)
    process.terminate()
    try:
        return int(process.wait(timeout=STOP_TIMEOUT_SECONDS))
    except subprocess.TimeoutExpired:  # pragma: no cover - regression guard
        process.kill()
        process.wait(timeout=STOP_TIMEOUT_SECONDS)
        raise AssertionError(f"backend ignored termination\n{_tail(log_path)}") from None


def _json_lines(log_path: Path) -> list[dict[str, object]]:
    """Reads the console log as JSON lines; unparsable lines are skipped."""

    if not log_path.exists():
        return []
    records: list[dict[str, object]] = []
    for line in _tail_text(log_path).splitlines():
        stripped = line.strip()
        if not stripped.startswith("{"):
            continue
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            records.append(parsed)
    return records


def _tail(log_path: Path) -> str:
    return _tail_text(log_path)[-2000:]


def _tail_text(log_path: Path) -> str:
    if not log_path.exists():
        return "<no output>"
    return log_path.read_text(encoding="utf-8", errors="replace")
