"""Configures process logging: JSON lines to a file, readable text to the console.

Logging must never take the application down. If the log file cannot be opened,
the backend keeps running with console output only and reports the degradation on
stderr, mirroring the fail-open rule the rest of the observability stack follows.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from megumi import __version__
from megumi.config import LoggingConfig

LOG_FILE_NAME = "backend.jsonl"

_LEVEL_BY_NAME: dict[str, int] = {
    "critical": logging.CRITICAL,
    "error": logging.ERROR,
    "warning": logging.WARNING,
    "info": logging.INFO,
    "debug": logging.DEBUG,
}

# LogRecord attributes that are never part of the structured payload.
_RESERVED_ATTRIBUTES = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "message",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)


class JsonLineFormatter(logging.Formatter):
    """Renders one log record as one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "at": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key in _RESERVED_ATTRIBUTES or key.startswith("_"):
                continue
            payload[key] = _jsonable(value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


class ConsoleFormatter(logging.Formatter):
    """Renders a compact single line for humans reading a terminal."""

    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
        head = f"{timestamp} {record.levelname:<7} {record.name}: {record.getMessage()}"
        extras = {
            key: _jsonable(value)
            for key, value in record.__dict__.items()
            if key not in _RESERVED_ATTRIBUTES and not key.startswith("_")
        }
        tail = f" {json.dumps(extras, ensure_ascii=False, default=str)}" if extras else ""
        if record.exc_info:
            tail += "\n" + self.formatException(record.exc_info)
        return head + tail


def configure_logging(config: LoggingConfig, logs_dir: Path) -> Path | None:
    """Installs console + file handlers and returns the log file path, if opened.

    Returns ``None`` when the log file could not be opened; console logging still
    works and the failure is reported on stderr.
    """

    level = _LEVEL_BY_NAME.get(config.level, logging.INFO)
    console = logging.StreamHandler(stream=sys.stderr)
    console.setFormatter(ConsoleFormatter() if config.format == "console" else JsonLineFormatter())

    handlers: list[logging.Handler] = [console]
    log_file: Path | None = None
    try:
        logs_dir.mkdir(parents=True, exist_ok=True)
        log_file = logs_dir / LOG_FILE_NAME
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(JsonLineFormatter())
        handlers.append(file_handler)
    except OSError as error:
        log_file = None
        print(
            json.dumps(
                {
                    "level": "warning",
                    "message": "Log file could not be opened; continuing with console logging.",
                    "logs_dir": str(logs_dir),
                    "reason": getattr(error, "strerror", None) or str(error),
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )

    logging.basicConfig(level=level, handlers=handlers, force=True)

    # uvicorn installs its own handlers; route them through ours instead.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    logging.getLogger("megumi").info(
        "backend.logging_configured",
        extra={
            "version": __version__,
            "level": config.level,
            "console_format": config.format,
            "log_file": str(log_file) if log_file else None,
        },
    )
    return log_file


def _jsonable(value: object) -> object:
    """Keeps structured fields serializable without failing the log call."""

    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    return str(value)
