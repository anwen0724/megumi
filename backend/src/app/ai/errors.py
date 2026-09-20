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
