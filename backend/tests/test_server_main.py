"""Server bootstrap: socket binding, port reporting and a real serve cycle."""

from __future__ import annotations

import asyncio
import socket
import threading
import time
from pathlib import Path

import httpx
import pytest
import uvicorn

from megumi.app import MegumiApp
from megumi.errors import ServerNotRunningError, ServerStartupError
from megumi.server.main import bind_server_socket, bound_address, read_bound_port, serve_app

READY_TIMEOUT_SECONDS = 20.0
POLL_INTERVAL_SECONDS = 0.05


def test_binding_port_zero_resolves_to_a_real_port() -> None:
    server_socket = bind_server_socket("127.0.0.1", 0)
    try:
        host, port = bound_address(server_socket)

        assert host == "127.0.0.1"
        assert port > 0
    finally:
        server_socket.close()


def test_binding_an_occupied_port_fails_with_a_stable_code() -> None:
    occupying = bind_server_socket("127.0.0.1", 0)
    _, taken_port = bound_address(occupying)
    try:
        with pytest.raises(ServerStartupError) as error:
            bind_server_socket("127.0.0.1", taken_port)

        assert error.value.code == "server_startup_failed"
        assert error.value.details["port"] == taken_port
    finally:
        occupying.close()


def test_reading_a_port_without_a_server_is_rejected() -> None:
    with pytest.raises(ServerNotRunningError):
        read_bound_port(None)


def test_bound_port_is_readable_once_the_server_is_running(config_for) -> None:
    megumi = MegumiApp.from_config(config_for)

    async def scenario() -> int:
        server_socket = bind_server_socket("127.0.0.1", 0)
        from megumi.server.main import create_uvicorn_server

        server = create_uvicorn_server(megumi, server_socket)
        try:
            await server.startup()
            return read_bound_port(server)
        finally:
            await server.shutdown()
            server_socket.close()

    assert asyncio.run(scenario()) > 0


def test_serving_the_app_answers_health_and_stops_cleanly(config_for, tmp_path: Path) -> None:
    megumi = MegumiApp.from_config(config_for)
    servers: list[uvicorn.Server] = []
    failures: list[BaseException] = []
    health: dict[str, object] = {}

    def run_server() -> None:
        try:
            asyncio.run(serve_app(megumi, on_ready=servers.append))
        except BaseException as error:  # noqa: BLE001 - reported through `failures`
            failures.append(error)

    thread = threading.Thread(target=run_server, name="megumi-server-test", daemon=True)
    thread.start()
    try:
        port = _wait_for_readiness(servers, failures)
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=5.0) as client:
            response = client.get("/health")
        assert response.status_code == 200
        health = response.json()
    finally:
        _stop_server(servers)
        thread.join(timeout=READY_TIMEOUT_SECONDS)

    assert not thread.is_alive()
    assert failures == []
    assert health["status"] == "ok"
    assert health["home"] == str(megumi.paths.home)
    assert megumi.started is False


def test_serve_app_reports_the_listening_port(config_for, caplog: pytest.LogCaptureFixture) -> None:
    megumi = MegumiApp.from_config(config_for)
    servers: list[uvicorn.Server] = []
    failures: list[BaseException] = []

    def run_server() -> None:
        try:
            asyncio.run(serve_app(megumi, on_ready=servers.append))
        except BaseException as error:  # noqa: BLE001
            failures.append(error)

    with caplog.at_level("INFO", logger="megumi.server.main"):
        thread = threading.Thread(target=run_server, daemon=True)
        thread.start()
        try:
            _wait_for_readiness(servers, failures)
        finally:
            _stop_server(servers)
            thread.join(timeout=READY_TIMEOUT_SECONDS)

    assert failures == []
    assert any(record.message == "server.listening" for record in caplog.records)


def _wait_for_readiness(servers: list[uvicorn.Server], failures: list[BaseException]) -> int:
    """Polls until the server reported its port, the thread died, or time runs out."""

    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if servers:
            return read_bound_port(servers[0])
        if failures:
            raise AssertionError(f"server failed to start: {failures[0]!r}")
        time.sleep(POLL_INTERVAL_SECONDS)
    raise AssertionError("server did not report readiness in time")


def _stop_server(servers: list[uvicorn.Server]) -> None:
    for server in servers:
        server.should_exit = True
