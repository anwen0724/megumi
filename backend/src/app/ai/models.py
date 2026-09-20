"""Explicit collection of provider configurations and model definitions."""

from collections.abc import Iterable

from app.ai.model import Model
from app.ai.provider import Provider


class Models:
    """Own a collection of provider definitions."""

    def __init__(self, providers: Iterable[Provider] = ()) -> None:
        self._providers = {provider.id: provider for provider in providers}

    def get_model(self, provider: str, model_id: str) -> Model | None:
        """Look up a provider-qualified model, returning None when absent."""
        entry = self._providers.get(provider)
        return (
            next((model for model in entry.models if model.id == model_id), None) if entry else None
        )

    def get_models(self, provider: str | None = None) -> tuple[Model, ...]:
        """Return all models or the catalog of one provider."""
        entries = (
            self._providers.values()
            if provider is None
            else ([self._providers[provider]] if provider in self._providers else [])
        )
        return tuple(model for entry in entries for model in entry.models)


def create_models(providers: Iterable[Provider] = ()) -> Models:
    """Create an independent model collection."""
    return Models(providers)
