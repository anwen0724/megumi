"""Starts and stops the HTTP server that fronts the backend.

The server is driven programmatically rather than through the uvicorn CLI so the
composition root keeps control of the socket, the bound port and the shutdown
order. Tests use the same code path, which is why the readiness helper exists.
"""

from __future__ import annotations

import asyncio
import logging
import socket
from collections.abc import Callable
from contextlib import suppress

import uvicorn

from megumi.app import MegumiApp
from megumi.errors import ServerNotRunningError, ServerStartupError
from megumi.server.app import create_app

logger = logging.getLogger(__name__)

HOST_PORT_SEPARATOR = ":"
DEFAULT_STARTUP_TIMEOUT_SECONDS = 30.0
STARTUP_POLL_INTERVAL_SECONDS = 0.02


def bind_server_socket(host: str, port: int) -> socket.socket:
    """Binds the listening socket, resolving port 0 to a concrete free port."""

    try:
        server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server_socket.bind((host, port))
        server_socket.listen(128)
    except OSError as error:
        raise ServerStartupError(
            f"Could not bind {host}{HOST_PORT_SEPARATOR}{port}.",
            details={"host": host, "port": port, "reason": error.strerror or str(error)},
            cause=error,
        ) from error
    return server_socket


def bound_address(server_socket: socket.socket) -> tuple[str, int]:
    """Returns the address the socket actually listens on."""

    address = server_socket.getsockname()
    return str(address[0]), int(address[1])


def create_uvicorn_server(megumi: MegumiApp, server_socket: socket.socket) -> uvicorn.Server:
    """Builds a uvicorn server sharing our logging configuration."""

    config = uvicorn.Config(
        create_app(megumi),
        log_config=None,
        log_level=None,
        lifespan="on",
        access_log=False,
    )
    return uvicorn.Server(config)


def read_bound_port(server: uvicorn.Server | None) -> int:
    """Reads the port of a running server; used to report readiness."""

    if server is None or not server.servers:
        raise ServerNotRunningError("The server has no listening socket.")
    sockets = server.servers[0].sockets
    if not sockets:
        raise ServerNotRunningError("The server has no listening socket.")
    address = sockets[0].getsockname()
    return int(address[1])


async def serve_app(
    megumi: MegumiApp,
    on_ready: Callable[[uvicorn.Server], None] | None = None,
    startup_timeout_seconds: float = DEFAULT_STARTUP_TIMEOUT_SECONDS,
) -> None:
    """Runs the server until it is asked to stop; used by the CLI and by tests.

    The whole lifecycle is delegated to ``uvicorn.Server.serve``: it creates the
    lifespan object, runs startup and shutdown, and captures signals itself, so
    Ctrl+C stops the loop and unwinds through the FastAPI lifespan into
    ``MegumiApp.dispose``. Driving ``startup``/``main_loop``/``shutdown`` by hand
    is not supported by uvicorn and leaves ``Server.lifespan`` unset.

    Readiness is reported only after uvicorn finished starting, because the
    socket is bound by us before the application has started: a caller that sees
    the address can then connect immediately.
    """

    server_socket = bind_server_socket(megumi.config.server.host, megumi.config.server.port)
    server = create_uvicorn_server(megumi, server_socket)
    host, port = bound_address(server_socket)
    serve_task = asyncio.create_task(server.serve(sockets=[server_socket]))
    try:
        await _wait_until_started(server, serve_task, timeout_seconds=startup_timeout_seconds)
        logger.info(
            "server.listening",
            extra={"host": host, "port": port, "url": f"http://{host}{HOST_PORT_SEPARATOR}{port}"},
        )
        if on_ready is not None:
            on_ready(server)
        await serve_task
    finally:
        if not serve_task.done():
            serve_task.cancel()
            with suppress(asyncio.CancelledError):
                await serve_task
        elif not serve_task.cancelled() and serve_task.exception() is not None:
            logger.error(
                "server.failed",
                extra={"reason": str(serve_task.exception())},
            )
        server_socket.close()
        if server.started:
            logger.info("server.stopped")


async def _wait_until_started(
    server: uvicorn.Server,
    serve_task: asyncio.Task[None],
    *,
    timeout_seconds: float,
) -> None:
    """Waits for uvicorn to report the application started, or fails fast."""

    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while not server.started:
        if serve_task.done():
            # serve() exited during startup, so the exception carries the reason.
            serve_task.result()
            raise ServerStartupError(
                "The server stopped before it finished starting.",
                details={"host": server.config.host, "port": server.config.port},
            )
        if asyncio.get_running_loop().time() >= deadline:
            raise ServerStartupError(
                f"The server did not finish starting within {timeout_seconds:.0f}s.",
                details={"host": server.config.host, "port": server.config.port},
            )
        await asyncio.sleep(STARTUP_POLL_INTERVAL_SECONDS)
