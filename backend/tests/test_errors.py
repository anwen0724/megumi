"""Error model: stable codes, wire shape and HTTP mapping."""

from __future__ import annotations

from megumi.errors import (
    ConfigError,
    HomeUnavailableError,
    MegumiError,
    ServerStartupError,
)


def test_base_error_carries_code_message_and_details() -> None:
    error = MegumiError("something broke", details={"key": "value"})

    assert error.to_dict() == {
        "code": "internal_error",
        "message": "something broke",
        "details": {"key": "value"},
    }


def test_details_are_omitted_when_empty() -> None:
    assert MegumiError("plain").to_dict() == {"code": "internal_error", "message": "plain"}


def test_subclasses_override_code_and_http_status() -> None:
    assert (ConfigError("bad config").code, ConfigError("bad config").http_status) == (
        "invalid_configuration",
        400,
    )
    assert (HomeUnavailableError("no home").code, HomeUnavailableError("no home").http_status) == (
        "home_unavailable",
        503,
    )
    assert (
        ServerStartupError("no socket").code,
        ServerStartupError("no socket").http_status,
    ) == ("server_startup_failed", 500)


def test_string_representation_includes_the_code() -> None:
    assert str(ConfigError("bad value")) == "[invalid_configuration] bad value"


def test_cause_is_preserved_for_diagnostics() -> None:
    original = OSError("disk full")

    error = HomeUnavailableError("cannot write", cause=original)

    assert error.cause is original
    assert error.__cause__ is None
