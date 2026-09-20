"""Which environment variable holds a provider's key.

A provider's key comes from a variable whose name is not always derived from the provider
id, and several providers read the same variable. A few providers accept more than one
name because the value can be either a plan key or a personal token.

More than one name means the first one that is set wins, so a caller can give a
service-account variable precedence over a personal one.
"""

from __future__ import annotations

from app.ai.types import ProviderEnv
from app.ai.utils.provider_env import getProviderEnvValue

__all__ = [
    "ANTHROPIC_API_KEY_ENV",
    "ANTHROPIC_AUTH_TOKEN_ENV",
    "ANTHROPIC_OAUTH_TOKEN_ENV",
    "findEnvKeys",
    "getEnvApiKey",
    "provider_env_vars",
]

ANTHROPIC_AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN"
ANTHROPIC_OAUTH_TOKEN_ENV = "ANTHROPIC_OAUTH_TOKEN"
ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY"

# The variables each provider reads, most specific first. A provider absent from this map
# has no environment variable.
_PROVIDER_ENV_VARS: dict[str, tuple[str, ...]] = {
    "anthropic": (ANTHROPIC_API_KEY_ENV, ANTHROPIC_AUTH_TOKEN_ENV, ANTHROPIC_OAUTH_TOKEN_ENV),
    "deepseek": ("DEEPSEEK_API_KEY",),
    "huggingface": ("HF_TOKEN",),
    "moonshotai": ("MOONSHOT_API_KEY",),
    "moonshotai-cn": ("MOONSHOT_API_KEY",),
}


def provider_env_vars(provider: str) -> tuple[str, ...]:
    """The variables ``provider`` reads, in the order they are consulted."""

    return _PROVIDER_ENV_VARS.get(provider, ())


def findEnvKeys(provider: str, env: ProviderEnv | None = None) -> list[str] | None:
    """The variables for ``provider`` that are set, or ``None`` when none is."""

    found = [
        name
        for name in provider_env_vars(provider)
        if getProviderEnvValue(name, env) is not None
    ]
    return found or None


def getEnvApiKey(provider: str, env: ProviderEnv | None = None) -> str | None:
    """The key ``provider`` should use from the environment, or ``None`` when none is set."""

    for name in provider_env_vars(provider):
        value = getProviderEnvValue(name, env)
        if value:
            return value
    return None
