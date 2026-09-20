"""The providers this layer ships with.

Each provider's catalogue is a generated file, written by ``scripts/generate_models.py`` from
the upstream model registry. The catalogue is loaded inside each factory so that importing
this module does not require every generated file to be present, and a missing one is
reported as the catalogue it names rather than as a broken import.
"""

from __future__ import annotations

from collections.abc import Callable

from app.ai.api.openai_completions_lazy import openAICompletionsApi
from app.ai.auth.helpers import env_api_key_auth
from app.ai.auth.types import ProviderAuth
from app.ai.models import Provider, createProvider
from app.ai.types import Model

__all__ = ["BUILTIN_PROVIDERS", "deepseekProvider", "huggingfaceProvider", "moonshotaiProvider"]


def _catalogue(provider_id: str) -> list[Model]:
    """Load a provider's generated catalogue, naming what is missing when it is absent."""

    from importlib import import_module

    try:
        module = import_module(f"app.ai.providers.{provider_id}_models")
    except ModuleNotFoundError as error:
        raise RuntimeError(
            f"The generated catalogue for {provider_id} is missing; "
            "run scripts/generate_models.py to create it",
        ) from error
    models: list[Model] = list(getattr(module, f"{provider_id.upper()}_MODELS").values())
    return models


def _builtin(
    provider_id: str,
    name: str,
    base_url: str,
    auth_name: str,
    env_vars: list[str],
) -> Provider:
    """Build a provider whose only differences are its identity and its key variable."""

    return createProvider(
        id=provider_id,
        name=name,
        baseUrl=base_url,
        auth=ProviderAuth(api_key=env_api_key_auth(auth_name, env_vars)),
        models=_catalogue(provider_id),
        api=openAICompletionsApi(),
    )


def deepseekProvider() -> Provider:
    """DeepSeek, reached through the OpenAI-compatible completions protocol."""

    return _builtin(
        "deepseek",
        "DeepSeek",
        "https://api.deepseek.com",
        "DeepSeek API key",
        ["DEEPSEEK_API_KEY"],
    )


def moonshotaiProvider() -> Provider:
    """Moonshot AI, reached through the OpenAI-compatible completions protocol."""

    return _builtin(
        "moonshotai",
        "Moonshot AI",
        "https://api.moonshot.ai/v1",
        "Moonshot AI API key",
        ["MOONSHOT_API_KEY"],
    )


def huggingfaceProvider() -> Provider:
    """The Hugging Face router, reached through the OpenAI-compatible completions protocol."""

    return _builtin(
        "huggingface",
        "Hugging Face",
        "https://router.huggingface.co/v1",
        "Hugging Face token",
        ["HF_TOKEN"],
    )


# The factories this module publishes, for a caller that wants them all.
BUILTIN_PROVIDERS: dict[str, Callable[[], Provider]] = {
    "deepseek": deepseekProvider,
    "huggingface": huggingfaceProvider,
    "moonshotai": moonshotaiProvider,
}
