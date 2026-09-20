"""Explicit collection of provider configurations and model definitions."""

from collections.abc import Iterable
from copy import deepcopy
from typing import Literal

from app.ai.auth.memory import InMemoryCredentialStore
from app.ai.auth.resolve import resolve_api_key, resolve_auth
from app.ai.auth.types import AuthOverride, CredentialStore, ResolvedAuth
from app.ai.catalog import snapshot_provider
from app.ai.errors import AuthError, ConfigurationError, LifecycleError
from app.ai.model import Model
from app.ai.provider import Provider


class Models:
    """Own a collection of provider definitions."""

    def __init__(
        self, providers: Iterable[Provider] = (), *, credentials: CredentialStore | None = None
    ) -> None:
        self._state: Literal["open", "closing", "closed"] = "open"
        self._credentials = credentials if credentials is not None else InMemoryCredentialStore()
        self._providers: dict[str, Provider] = {}
        for provider in providers:
            self.set_provider(provider)

    async def aclose(self) -> None:
        """Close configuration services idempotently; no transport exists yet."""
        if self._state == "closed":
            return
        self._state = "closing"
        self._state = "closed"

    def _ensure_open(self) -> None:
        if self._state != "open":
            raise LifecycleError("Models collection is closed")

    def set_provider(self, provider: Provider) -> None:
        """Add or fully replace one provider definition."""
        self._ensure_open()
        snapshot = snapshot_provider(provider)
        self._providers[snapshot.id] = snapshot

    def get_model(self, provider: str, model_id: str) -> Model | None:
        """Look up a provider-qualified model, returning None when absent."""
        self._ensure_open()
        entry = self._providers.get(provider)
        return (
            deepcopy(next((model for model in entry.models if model.id == model_id), None))
            if entry
            else None
        )

    def get_models(self, provider: str | None = None) -> tuple[Model, ...]:
        """Return all models or the catalog of one provider."""
        self._ensure_open()
        entries = (
            self._providers.values()
            if provider is None
            else ([self._providers[provider]] if provider in self._providers else [])
        )
        return tuple(deepcopy(model) for entry in entries for model in entry.models)

    async def get_available_models(self, provider: str | None = None) -> tuple[Model, ...]:
        """Filter missing credentials; propagate configuration and storage failures."""
        self._ensure_open()
        entries = tuple(
            self._providers.values()
            if provider is None
            else ([self._providers[provider]] if provider in self._providers else [])
        )
        available: list[Model] = []
        for entry in entries:
            try:
                await resolve_api_key(entry, AuthOverride(), self._credentials, None)
            except AuthError as exc:
                if exc.code == "not_configured":
                    continue
                raise
            available.extend(deepcopy(model) for model in entry.models)
        return tuple(available)

    async def resolve_auth(
        self, model: Model, overrides: AuthOverride | None = None
    ) -> ResolvedAuth:
        """Prepare authentication using the current registered model's snapshot."""
        self._ensure_open()
        provider = self._providers.get(model.provider)
        current = self.get_model(model.provider, model.id)
        if provider is None or current is None:
            raise ConfigurationError("Model is not registered")
        return await resolve_auth(provider, current, overrides, credentials=self._credentials)


def create_models(
    providers: Iterable[Provider] = (), *, credentials: CredentialStore | None = None
) -> Models:
    """Create an independent model collection."""
    return Models(providers, credentials=credentials)
