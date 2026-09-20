"""Credential contracts independent of persistence and HTTP clients."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal, Protocol


@dataclass(frozen=True, slots=True)
class ApiKeyCredential:
    """An API key, excluded from diagnostic representations."""

    key: str = field(repr=False)


class CredentialStore(Protocol):
    """Provider-scoped async credential storage."""

    async def read(self, provider_id: str) -> ApiKeyCredential | None:
        """Read a credential; None means absent, not failed."""
        ...

    async def set(self, provider_id: str, credential: ApiKeyCredential) -> None:
        """Replace a provider credential."""
        ...

    async def delete(self, provider_id: str) -> None:
        """Remove a provider credential."""
        ...


@dataclass(frozen=True, slots=True)
class AuthOverride:
    """Request-scoped overrides; never persisted back to a credential store."""

    api_key: str | None = field(default=None, repr=False)
    headers: Mapping[str, str | None] = field(default_factory=dict, repr=False)


@dataclass(frozen=True, slots=True)
class ResolvedAuth:
    """An independent request configuration with a redacted representation."""

    key: str = field(repr=False)
    source: Literal["explicit", "stored", "environment"]
    base_url: str
    headers: Mapping[str, str] = field(default_factory=dict, repr=False)
