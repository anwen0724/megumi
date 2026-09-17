"""Defines the backend's error model: one base exception carrying a stable code.

Every failure that can reach a caller (a CLI invocation now, an RPC operation
later) is raised as a MegumiError subclass with a stable machine-readable code.
Callers map the code to their own surface: the CLI prints JSON and exits
non-zero, the HTTP layer maps ``http_status`` to a response status.
"""

from __future__ import annotations

from typing import Any


class MegumiError(Exception):
    """Base class for every failure the backend wants to report in a stable shape."""

    code: str = "internal_error"
    http_status: int = 500

    def __init__(
        self,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details: dict[str, Any] = dict(details or {})
        self.cause = cause

    def to_dict(self) -> dict[str, Any]:
        """Returns the wire shape shared by the CLI, the HTTP layer and later RPC."""

        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            error["details"] = self.details
        return error

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"


class ConfigError(MegumiError):
    """A configuration value is missing, malformed or out of range."""

    code = "invalid_configuration"
    http_status = 400


class HomeUnavailableError(MegumiError):
    """The Megumi Home directory cannot be created or written to."""

    code = "home_unavailable"
    http_status = 503


class ServerStartupError(MegumiError):
    """The HTTP server could not start."""

    code = "server_startup_failed"
    http_status = 500


class ServerNotRunningError(MegumiError):
    """A server operation was requested while no server is running."""

    code = "server_not_running"
    http_status = 409
