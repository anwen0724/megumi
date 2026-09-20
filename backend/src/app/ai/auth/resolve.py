"""Resolve one request's credentials and configuration without mutating sources."""

import os
from collections.abc import Callable
from typing import Literal

from app.ai.auth.types import ApiKeyCredential, AuthOverride, CredentialStore, ResolvedAuth
from app.ai.catalog import validate_headers, validate_url
from app.ai.errors import AuthError, ConfigurationError
from app.ai.model import Model
from app.ai.provider import Provider


async def resolve_auth(
    provider: Provider,
    model: Model,
    overrides: AuthOverride | None = None,
    *,
    credentials: CredentialStore,
    env_read: Callable[[str], str | None] | None = None,
) -> ResolvedAuth:
    """Resolve an independent request configuration; never contact a provider."""
    overrides = overrides or AuthOverride()
    if model.provider != provider.id or model.api != provider.api:
        raise ConfigurationError("Model does not match provider identity or protocol")
    endpoint = model.base_url if model.base_url is not None else provider.base_url
    validate_url(endpoint)
    headers: dict[str, str] = {}
    for layer in (provider.headers, model.headers, overrides.headers):
        validate_headers(layer)
        for name, value in layer.items():
            normalized = name.lower()
            if value is None:
                headers.pop(normalized, None)
            else:
                headers[normalized] = value
    key, source = await _resolve_key(provider, overrides, credentials, env_read)
    headers["authorization"] = f"Bearer {key}"
    return ResolvedAuth(key=key, source=source, base_url=endpoint, headers=headers)


async def _resolve_key(
    provider: Provider,
    overrides: AuthOverride,
    credentials: CredentialStore,
    env_read: Callable[[str], str | None] | None,
) -> tuple[str, Literal["explicit", "stored", "environment"]]:
    """Short-circuit credential sources; only missing values allow fallback."""
    if overrides.api_key is not None:
        return _validate_key(overrides.api_key), "explicit"
    try:
        credential = await credentials.read(provider.id)
    except Exception:
        raise AuthError("credential_store_error") from None
    if credential is not None:
        if not isinstance(credential, ApiKeyCredential):
            raise AuthError("invalid_credential")
        return _validate_key(credential.key), "stored"
    value = (env_read or os.getenv)(provider.env_var)
    if value is not None and value.strip():
        return _validate_key(value), "environment"
    raise AuthError("not_configured")


def _validate_key(key: str) -> str:
    """Validate local syntax without claiming remote validity."""
    if not isinstance(key, str) or not key.strip() or "\r" in key or "\n" in key:
        raise AuthError("invalid_credential")
    return key
