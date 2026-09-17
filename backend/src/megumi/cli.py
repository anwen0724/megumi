"""Command line entry points: ``run`` starts the backend, ``doctor`` checks the setup."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from collections.abc import Sequence
from dataclasses import replace

from megumi import __version__
from megumi.app import MegumiApp
from megumi.config import BackendConfig, ServerConfig, load_config, parse_port
from megumi.errors import ConfigError, MegumiError
from megumi.logging_setup import configure_logging
from megumi.server.main import bind_server_socket, bound_address, serve_app

logger = logging.getLogger(__name__)

EXIT_OK = 0
EXIT_FAILURE = 2


def main(argv: Sequence[str] | None = None) -> int:
    """Parses arguments, runs one command and returns the process exit code.

    Every expected failure (bad configuration, unusable Home, port already in
    use) is reported as one JSON line on stderr with a stable exit code; only
    unexpected programming errors are allowed to raise.
    """

    configure_console_encoding()
    parser = _build_parser()
    args = parser.parse_args(argv)

    try:
        config = load_config()
        if args.command == "run":
            if args.port is not None:
                config = _replace_port(config, args.port)
            if args.host is not None:
                config = _replace_host(config, args.host)
    except MegumiError as error:
        _report_startup_failure(error)
        return EXIT_FAILURE

    configure_logging(config.logging, config.paths.logs_dir)

    try:
        if args.command == "doctor":
            return _run_doctor(config)
        app = MegumiApp.from_config(config)
        asyncio.run(serve_app(app))
    except MegumiError as error:
        logger.error("backend.failed", extra={"code": error.code, "message": error.message})
        _report_startup_failure(error)
        return EXIT_FAILURE
    except KeyboardInterrupt:  # pragma: no cover - interactive path
        logger.info("backend.interrupted")
    return EXIT_OK


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="megumi",
        description="Megumi backend (Python).",
    )
    parser.add_argument("--version", action="version", version=f"megumi {__version__}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="start the backend HTTP server")
    run_parser.add_argument("--host", help="bind address (default: 127.0.0.1)")
    run_parser.add_argument("--port", type=int, help="bind port; 0 picks a free port")

    subparsers.add_parser("doctor", help="check the local setup without starting the server")
    return parser


def _replace_port(config: BackendConfig, port: int) -> BackendConfig:
    """Applies a command line port, validating it against the shared range rule."""

    return replace(config, server=ServerConfig(host=config.server.host, port=parse_port(str(port))))


def _replace_host(config: BackendConfig, host: str) -> BackendConfig:
    stripped = host.strip()
    if not stripped:
        raise ConfigError("--host must not be empty.", details={"value": host})
    return replace(config, server=ServerConfig(host=stripped, port=config.server.port))


def _run_doctor(config: BackendConfig) -> int:
    """Reports the local setup; never starts the server."""

    checks: list[tuple[str, str, str]] = [
        (
            "python",
            f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "ok",
        ),
        ("backend version", __version__, "ok"),
        ("home", str(config.paths.home), "ok" if config.paths.home.parent.is_dir() else "missing"),
        ("stdout encoding", sys.stdout.encoding or "unknown", "ok"),
    ]

    try:
        probe = bind_server_socket(config.server.host, config.server.port)
    except MegumiError as error:
        checks.append(("bind", f"{config.server.host}:{config.server.port}", error.code))
    else:
        host, port = bound_address(probe)
        probe.close()
        checks.append(("bind", f"http://{host}:{port}", "ok"))

    for name, value, status in checks:
        print(f"{status:<8} {name:<18} {value}")
    return EXIT_OK if all(status != "missing" for _, _, status in checks) else EXIT_FAILURE


def configure_console_encoding() -> None:
    """Makes Windows consoles print UTF-8 so Chinese text survives.

    Encoding is best-effort: a console that cannot be reconfigured must not stop
    the backend from running.
    """

    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8")
        except (OSError, ValueError):  # pragma: no cover - platform specific
            continue


def _report_startup_failure(error: MegumiError) -> None:
    """Prints one machine-readable line so a host process can show the reason."""

    print(
        json.dumps({"level": "error", "message": error.message, "error": error.to_dict()}, ensure_ascii=False),
        file=sys.stderr,
    )
