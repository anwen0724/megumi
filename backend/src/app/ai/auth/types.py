"""Credential contracts independent of persistence and HTTP clients."""

from dataclasses import dataclass, field
from typing import Protocol


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
