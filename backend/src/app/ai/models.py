"""Explicit collection of provider configurations and model definitions."""

from collections.abc import Iterable
from copy import deepcopy

from app.ai.catalog import snapshot_provider
from app.ai.model import Model
from app.ai.provider import Provider


class Models:
    """Own a collection of provider definitions."""

    def __init__(self, providers: Iterable[Provider] = ()) -> None:
        self._providers: dict[str, Provider] = {}
        for provider in providers:
            self.set_provider(provider)

    def set_provider(self, provider: Provider) -> None:
        """Add or fully replace one provider definition."""
        snapshot = snapshot_provider(provider)
        self._providers[snapshot.id] = snapshot

    def get_model(self, provider: str, model_id: str) -> Model | None:
        """Look up a provider-qualified model, returning None when absent."""
        entry = self._providers.get(provider)
        return (
            deepcopy(next((model for model in entry.models if model.id == model_id), None))
            if entry
            else None
        )

    def get_models(self, provider: str | None = None) -> tuple[Model, ...]:
        """Return all models or the catalog of one provider."""
        entries = (
            self._providers.values()
            if provider is None
            else ([self._providers[provider]] if provider in self._providers else [])
        )
        return tuple(deepcopy(model) for entry in entries for model in entry.models)


def create_models(providers: Iterable[Provider] = ()) -> Models:
    """Create an independent model collection."""
    return Models(providers)
