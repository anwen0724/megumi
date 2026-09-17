"""Logging setup: file sink, JSON shape, console format and fail-open behaviour."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest

from megumi.config import LoggingConfig
from megumi.logging_setup import LOG_FILE_NAME, configure_logging


@pytest.fixture(autouse=True)
def restore_logging() -> object:
    """Keeps global logging configuration from leaking between tests."""

    saved = logging.root.handlers[:]
    saved_level = logging.root.level
    yield None
    logging.root.handlers[:] = saved
    logging.root.setLevel(saved_level)


def test_log_file_is_created_inside_the_logs_directory(tmp_path: Path) -> None:
    log_file = configure_logging(LoggingConfig(), tmp_path / "logs")

    assert log_file == tmp_path / "logs" / LOG_FILE_NAME
    assert log_file is not None and log_file.is_file()


def test_file_sink_writes_one_json_object_per_line(tmp_path: Path) -> None:
    log_file = configure_logging(LoggingConfig(level="info"), tmp_path / "logs")
    assert log_file is not None

    logging.getLogger("megumi.test").info("test.event", extra={"answer": 42})

    for handler in logging.getLogger().handlers:
        handler.flush()
    lines = [line for line in log_file.read_text(encoding="utf-8").splitlines() if line.strip()]
    record = json.loads(lines[-1])

    assert record["message"] == "test.event"
    assert record["level"] == "info"
    assert record["logger"] == "megumi.test"
    assert record["answer"] == 42
    assert "at" in record


def test_chinese_text_is_written_as_utf8(tmp_path: Path) -> None:
    log_file = configure_logging(LoggingConfig(level="info"), tmp_path / "logs")
    assert log_file is not None

    logging.getLogger("megumi.test").info("兴趣提取完成", extra={"兴趣": "Agent"})

    for handler in logging.getLogger().handlers:
        handler.flush()
    lines = log_file.read_text(encoding="utf-8").splitlines()
    assert "兴趣提取完成" in lines[-1]


def test_configured_level_filters_lower_level_records(tmp_path: Path) -> None:
    log_file = configure_logging(LoggingConfig(level="warning"), tmp_path / "logs")
    assert log_file is not None

    logging.getLogger("megumi.test").info("should.not.appear")
    logging.getLogger("megumi.test").warning("should.appear")

    for handler in logging.getLogger().handlers:
        handler.flush()
    content = log_file.read_text(encoding="utf-8")
    assert "should.appear" in content
    assert "should.not.appear" not in content


def test_unwritable_log_directory_keeps_logging_alive(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    blocked = tmp_path / "blocked"
    blocked.write_text("this is a file", encoding="utf-8")

    log_file = configure_logging(LoggingConfig(), blocked)

    assert log_file is None
    captured = capsys.readouterr()
    assert "continuing with console logging" in captured.err


def test_uvicorn_loggers_propagate_to_our_handlers(tmp_path: Path) -> None:
    configure_logging(LoggingConfig(), tmp_path / "logs")

    uvicorn_logger = logging.getLogger("uvicorn.error")

    assert uvicorn_logger.handlers == []
    assert uvicorn_logger.propagate is True
