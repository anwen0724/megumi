"""Errors at configuration and collection boundaries."""

from typing import Literal


class ConfigurationError(ValueError):
    """A provider configuration cannot be published."""


class AuthError(RuntimeError):
    """Distinguish unconfigured authentication from invalid data and store failure."""

    def __init__(
        self, code: Literal["not_configured", "invalid_credential", "credential_store_error"]
    ) -> None:
        self.code = code
        messages = {
            "not_configured": "Provider authentication is not configured",
            "invalid_credential": "API key credential is invalid",
            "credential_store_error": "Credential store read failed",
        }
        super().__init__(messages[code])


class LifecycleError(RuntimeError):
    """A model collection service was used after closing."""


class MessageDecodeError(ValueError):
    """Saved message data does not satisfy the message contract."""


class ToolValidationError(ValueError):
    """An unknown tool or invalid argument with a caller-readable path and cause."""

    def __init__(self, path: str, reason: str) -> None:
        self.path = path
        self.reason = reason
        super().__init__(f"{path}: {reason}")


class StrictSchemaError(ValueError):
    """A required provider strict schema cannot preserve the declared tool contract."""
