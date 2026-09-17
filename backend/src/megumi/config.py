"""Loads the backend's own configuration from the environment.

This is the configuration of the backend process itself (where Home is, how it
logs, which address it binds). It is deliberately not the user-facing
``settings.json`` model — that belongs to the settings feature and will be added
when the settings operation is implemented.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

from megumi.errors import ConfigError
from megumi.paths import HomePaths, build_home_paths, resolve_home_path

LOG_LEVELS: Final[tuple[str, ...]] = ("critical", "error", "warning", "info", "debug")
LOG_FORMATS: Final[tuple[str, ...]] = ("console", "json")

# Defaults live here and are referenced by both the dataclasses and the loader.
# They must never be read back off the dataclass classes: on a dataclass, the
# class attribute is a slot/member descriptor, not the default value.
DEFAULT_HOST: Final[str] = "127.0.0.1"
DEFAULT_PORT: Final[int] = 0
DEFAULT_LOG_LEVEL: Final[str] = "info"
DEFAULT_LOG_FORMAT: Final[str] = "console"

# Ports below 1024 need privileges on most systems, so they are rejected up front.
MIN_PORT: Final[int] = 1024
MAX_PORT: Final[int] = 65535


@dataclass(frozen=True, slots=True)
class ServerConfig:
    """Address the backend binds to. Port 0 asks the OS for a free port."""

    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT


@dataclass(frozen=True, slots=True)
class LoggingConfig:
    """Log level and the console rendering format.

    Log files always use JSON lines; ``format`` only controls the console.
    """

    level: str = DEFAULT_LOG_LEVEL
    format: str = DEFAULT_LOG_FORMAT


@dataclass(frozen=True, slots=True)
class BackendConfig:
    """Everything the process needs before it can start."""

    home: Path
    server: ServerConfig = field(default_factory=ServerConfig)
    logging: LoggingConfig = field(default_factory=LoggingConfig)

    @property
    def paths(self) -> HomePaths:
        return build_home_paths(self.home)


def load_config(environ: dict[str, str] | None = None) -> BackendConfig:
    """Reads configuration from environment variables with documented defaults.

    ``MEGUMI_HOME``      Home root; defaults to ``<user home>/.megumi``
    ``MEGUMI_HOST``      bind address; defaults to ``127.0.0.1``
    ``MEGUMI_PORT``      bind port; defaults to ``0`` (OS picks a free port)
    ``MEGUMI_LOG_LEVEL`` one of critical/error/warning/info/debug
    ``MEGUMI_LOG_FORMAT`` console or json
    """

    source = os.environ if environ is None else environ
    return BackendConfig(
        home=resolve_home_path(source.get("MEGUMI_HOME")),
        server=ServerConfig(
            host=_read_text(source, "MEGUMI_HOST", DEFAULT_HOST),
            port=_read_port(source, "MEGUMI_PORT", DEFAULT_PORT),
        ),
        logging=LoggingConfig(
            level=_read_choice(source, "MEGUMI_LOG_LEVEL", LOG_LEVELS, DEFAULT_LOG_LEVEL),
            format=_read_choice(source, "MEGUMI_LOG_FORMAT", LOG_FORMATS, DEFAULT_LOG_FORMAT),
        ),
    )


def parse_port(raw: str) -> int:
    """Parses a port value; 0 means "let the OS pick a free port".

    Shared by the environment loader and the command line so both entry points
    accept exactly the same range.
    """

    text = raw.strip()
    if not text:
        raise ConfigError(
            "Port value is empty.",
            details={"value": raw},
        )
    try:
        port = int(text)
    except ValueError as error:
        raise ConfigError(
            f"Port must be an integer, got {raw!r}.",
            details={"value": raw},
            cause=error,
        ) from error
    if port != 0 and not (MIN_PORT <= port <= MAX_PORT):
        raise ConfigError(
            f"Port must be 0 or between {MIN_PORT} and {MAX_PORT}, got {port}.",
            details={"value": raw},
        )
    return port


def _read_text(source: dict[str, str], name: str, default: str) -> str:
    value = source.get(name, "").strip()
    return value or default


def _read_port(source: dict[str, str], name: str, default: int) -> int:
    raw = source.get(name, "").strip()
    if not raw:
        return default
    try:
        return parse_port(raw)
    except ConfigError as error:
        raise ConfigError(
            f"{error.message} ({name})",
            details={"variable": name, **error.details},
            cause=error,
        ) from error


def _read_choice(
    source: dict[str, str],
    name: str,
    allowed: tuple[str, ...],
    default: str,
) -> str:
    raw = source.get(name, "").strip().lower()
    if not raw:
        return default
    if raw not in allowed:
        raise ConfigError(
            f"{name} must be one of {', '.join(allowed)}; got {raw!r}.",
            details={"variable": name, "value": raw, "allowed": list(allowed)},
        )
    return raw
