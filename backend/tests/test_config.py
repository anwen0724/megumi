"""Config loading: defaults, overrides and rejection of invalid values."""

from __future__ import annotations

from pathlib import Path

import pytest

from megumi.config import load_config
from megumi.errors import ConfigError


def test_defaults_match_documented_values(clean_environment: pytest.MonkeyPatch) -> None:
    config = load_config()

    assert config.server.host == "127.0.0.1"
    assert config.server.port == 0
    assert config.logging.level == "info"
    assert config.logging.format == "console"


def test_defaults_are_plain_values_not_dataclass_descriptors(
    clean_environment: pytest.MonkeyPatch,
) -> None:
    """Guards against reading defaults off the dataclass classes.

    On a slots dataclass the class attribute is a member descriptor, so using
    ``ServerConfig.host`` as a default silently yields a descriptor object.
    """

    config = load_config()

    assert type(config.server.host) is str
    assert type(config.server.port) is int
    assert type(config.logging.level) is str
    assert type(config.logging.format) is str


def test_dataclass_defaults_match_the_loader_defaults() -> None:
    from megumi.config import (
        DEFAULT_HOST,
        DEFAULT_LOG_FORMAT,
        DEFAULT_LOG_LEVEL,
        DEFAULT_PORT,
        LoggingConfig,
        ServerConfig,
    )

    assert ServerConfig().host == DEFAULT_HOST
    assert ServerConfig().port == DEFAULT_PORT
    assert LoggingConfig().level == DEFAULT_LOG_LEVEL
    assert LoggingConfig().format == DEFAULT_LOG_FORMAT


def test_home_defaults_to_dot_megumi_under_user_home(clean_environment: pytest.MonkeyPatch) -> None:
    config = load_config()

    assert config.home.name == ".megumi"
    assert config.home.is_absolute()


def test_environment_overrides_every_value(clean_environment: pytest.MonkeyPatch, tmp_path: Path) -> None:
    clean_environment.setenv("MEGUMI_HOME", str(tmp_path / "custom"))
    clean_environment.setenv("MEGUMI_HOST", "localhost")
    clean_environment.setenv("MEGUMI_PORT", "8420")
    clean_environment.setenv("MEGUMI_LOG_LEVEL", "DEBUG")
    clean_environment.setenv("MEGUMI_LOG_FORMAT", "json")

    config = load_config()

    assert config.home == (tmp_path / "custom").resolve()
    assert config.server.host == "localhost"
    assert config.server.port == 8420
    assert config.logging.level == "debug"
    assert config.logging.format == "json"


def test_blank_values_fall_back_to_defaults(clean_environment: pytest.MonkeyPatch) -> None:
    clean_environment.setenv("MEGUMI_HOME", "   ")
    clean_environment.setenv("MEGUMI_PORT", "  ")
    clean_environment.setenv("MEGUMI_LOG_LEVEL", "")

    config = load_config()

    assert config.home.name == ".megumi"
    assert config.server.port == 0
    assert config.logging.level == "info"


def test_non_numeric_port_is_rejected(clean_environment: pytest.MonkeyPatch) -> None:
    clean_environment.setenv("MEGUMI_PORT", "http")

    with pytest.raises(ConfigError) as error:
        load_config()

    assert error.value.code == "invalid_configuration"
    assert error.value.details["variable"] == "MEGUMI_PORT"


@pytest.mark.parametrize("port", ["-1", "80", "70000"])
def test_out_of_range_port_is_rejected(clean_environment: pytest.MonkeyPatch, port: str) -> None:
    clean_environment.setenv("MEGUMI_PORT", port)

    with pytest.raises(ConfigError):
        load_config()


def test_unknown_log_level_is_rejected(clean_environment: pytest.MonkeyPatch) -> None:
    clean_environment.setenv("MEGUMI_LOG_LEVEL", "verbose")

    with pytest.raises(ConfigError) as error:
        load_config()

    assert error.value.details["allowed"] == ["critical", "error", "warning", "info", "debug"]


def test_unknown_log_format_is_rejected(clean_environment: pytest.MonkeyPatch) -> None:
    clean_environment.setenv("MEGUMI_LOG_FORMAT", "xml")

    with pytest.raises(ConfigError):
        load_config()
