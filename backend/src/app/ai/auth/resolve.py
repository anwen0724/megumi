"""Resolve one request's credentials without altering any input source."""

import os
from collections.abc import Callable

from app.ai.auth.types import ApiKeyCredential, AuthOverride, CredentialStore, ResolvedAuth
from app.ai.errors import AuthError
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
    """Resolve request authentication; environment access is an injectable boundary."""
    if overrides is not None and overrides.api_key is not None:
        return ResolvedAuth(
            key=_validate_key(overrides.api_key), source="explicit", base_url=provider.base_url
        )
    try:
        credential = await credentials.read(provider.id)
    except Exception:
        raise AuthError("credential_store_error") from None
    if credential is not None and not isinstance(credential, ApiKeyCredential):
        raise AuthError("invalid_credential")
    if credential is not None:
        return ResolvedAuth(
            key=_validate_key(credential.key), source="stored", base_url=provider.base_url
        )
    value = (env_read or os.getenv)(provider.env_var)
    if value is not None and value.strip():
        return ResolvedAuth(
            key=_validate_key(value), source="environment", base_url=provider.base_url
        )
    raise AuthError("not_configured")


def _validate_key(key: str) -> str:
    """Validate local credential syntax without claiming remote validity."""
    if not isinstance(key, str) or not key.strip() or "\r" in key or "\n" in key:
        raise AuthError("invalid_credential")
    return key
