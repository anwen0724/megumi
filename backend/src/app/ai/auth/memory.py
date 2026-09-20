"""Process-local provider credentials without environment or disk side effects."""

from app.ai.auth.types import ApiKeyCredential


class InMemoryCredentialStore:
    """Store immutable credentials by provider identity."""

    def __init__(self) -> None:
        self._credentials: dict[str, ApiKeyCredential] = {}

    async def read(self, provider_id: str) -> ApiKeyCredential | None:
        """Return the configured credential or None."""
        return self._credentials.get(provider_id)

    async def set(self, provider_id: str, credential: ApiKeyCredential) -> None:
        """Set a provider credential."""
        self._credentials[provider_id] = credential

    async def delete(self, provider_id: str) -> None:
        """Remove a credential without changing any other source."""
        self._credentials.pop(provider_id, None)
