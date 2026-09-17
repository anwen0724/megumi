"""Shared pytest fixtures for the backend test suite."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from megumi.config import BackendConfig, LoggingConfig, ServerConfig


@pytest.fixture
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    """Removes every MEGUMI_* variable so tests see documented defaults."""

    for name in (
        "MEGUMI_HOME",
        "MEGUMI_HOST",
        "MEGUMI_PORT",
        "MEGUMI_LOG_LEVEL",
        "MEGUMI_LOG_FORMAT",
    ):
        monkeypatch.delenv(name, raising=False)
    yield monkeypatch


@pytest.fixture
def config_for(tmp_path: Path) -> BackendConfig:
    """A backend configuration whose Home lives inside the test's temp directory."""

    return BackendConfig(
        home=tmp_path / "home",
        server=ServerConfig(host="127.0.0.1", port=0),
        logging=LoggingConfig(level="warning", format="console"),
    )
