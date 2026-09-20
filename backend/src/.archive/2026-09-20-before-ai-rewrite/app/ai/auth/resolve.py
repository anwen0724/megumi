"""Resolving the auth one provider request needs.

A provider has at most one stored credential, and that credential owns the provider: once
something is stored, the ambient environment is not consulted at all. That rule is what
makes an explicit login stick — a stale environment variable cannot silently take over
after a login, and a credential whose type the provider cannot use fails rather than
falling back to a different source.

Precedence for a key is therefore: the caller's explicit override, then the stored
credential, then the environment.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from app.ai.auth.context import default_provider_auth_context
from app.ai.auth.types import (
    ApiKeyAuth,
    ApiKeyCredential,
    AuthContext,
    AuthRequest,
    AuthResolutionOverrides,
    AuthResult,
    Credential,
    CredentialStore,
    OAuthAuth,
    OAuthCredential,
    ProviderAuth,
)
from app.ai.types import ProviderEnv
from app.ai.utils.abort import AbortSignal
from app.ai.utils.diagnostics import format_thrown_value

__all__ = [
    "ModelsError",
    "ModelsErrorCode",
    "default_provider_auth_context",
    "resolve_provider_auth",
]

ModelsErrorCode = str


class ModelsError(Exception):
    """A failure that names the part of the layer it came from.

    A caller surfaces the message, so the underlying reason is folded into it rather than
    left in a cause the caller would not print.
    """

    def __init__(
        self,
        code: ModelsErrorCode,
        message: str,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(_with_cause_detail(message, cause))
        self.name = "ModelsError"
        self.code = code


def _with_cause_detail(message: str, cause: BaseException | None) -> str:
    """Append the underlying reason to a message when it is not already there."""

    if cause is None:
        return message
    detail = format_thrown_value(cause).strip()
    if not detail or detail in message:
        return message
    return f"{message}: {detail}"


async def _read_credential(
    credentials: CredentialStore,
    provider_id: str,
    signal: AbortSignal | None,
) -> Credential | None:
    """Read the stored credential, reporting a store failure as an auth error."""

    try:
        return await credentials.read(provider_id)
    except BaseException as error:
        raise ModelsError(
            "auth",
            f"Failed to read the stored credential for {provider_id}",
            error,
        ) from error


def _overlay_env(auth_context: AuthContext, env: ProviderEnv) -> AuthContext:
    """An auth context whose scoped values win over the real environment."""

    class _ScopedContext:
        async def env(self, name: str) -> str | None:
            scoped = env.get(name)
            if scoped:
                return scoped
            return await auth_context.env(name)

        async def fileExists(self, path: str) -> bool:
            return await auth_context.fileExists(path)

    return _ScopedContext()


async def resolve_provider_auth(
    provider_id: str,
    auth: ProviderAuth,
    credentials: CredentialStore,
    auth_context: AuthContext | None = None,
    overrides: AuthResolutionOverrides | None = None,
) -> AuthResult | None:
    """Resolve the values one request should send for ``provider_id``.

    Returns ``None`` when the provider is unconfigured, which is the state a caller reports
    to the user rather than treating as a failure.
    """

    context: AuthContext = (
        auth_context if auth_context is not None else default_provider_auth_context()
    )
    scoped = overrides.env if overrides else None
    request_context = _overlay_env(context, scoped) if scoped else context
    signal = getattr(overrides, "signal", None) if overrides else None

    if overrides is not None and overrides.apiKey is not None and auth.api_key is not None:
        return await _resolve_api_key(
            request_context,
            provider_id,
            auth.api_key,
            ApiKeyCredential(key=overrides.apiKey, env=overrides.env),
            signal,
        )

    stored = await _read_credential(credentials, provider_id, signal)
    if stored is not None:
        if isinstance(stored, OAuthCredential) and auth.oauth is not None:
            return await _resolve_oauth(credentials, provider_id, stored, auth.oauth, signal)
        if isinstance(stored, ApiKeyCredential) and auth.api_key is not None:
            return await _resolve_api_key(
                request_context,
                provider_id,
                auth.api_key,
                stored,
                signal,
            )
        # A credential the provider cannot use is a broken state, not a reason to fall back
        # to the environment: the stored credential owns the provider.
        raise ModelsError(
            "auth",
            f"Stored credential for {provider_id} cannot be used by its auth method",
        )

    if auth.api_key is not None:
        return await _resolve_api_key(request_context, provider_id, auth.api_key, None, signal)
    return None


async def _resolve_api_key(
    auth_context: AuthContext,
    provider_id: str,
    auth: ApiKeyAuth,
    credential: ApiKeyCredential | None,
    signal: AbortSignal | None,
) -> AuthResult | None:
    """Resolve an API key from the credential, then from the environment."""

    del provider_id
    return await auth.resolve(AuthRequest(ctx=auth_context, credential=credential, signal=signal))


async def _resolve_oauth(
    credentials: CredentialStore,
    provider_id: str,
    stored: OAuthCredential,
    auth: OAuthAuth,
    signal: AbortSignal | None,
) -> AuthResult:
    """Resolve a stored token, renewing it under the store's lock when it is close to expiry."""

    del signal
    credential = stored
    if _needs_refresh(credential):
        if auth.refresh is None:
            raise ModelsError(
                "oauth",
                f"Stored credential for {provider_id} expired and cannot be refreshed",
            )
        try:
            # The renewal runs inside the store's locked read-modify-write, so two requests
            # cannot refresh the same credential at once.
            renewed = await credentials.modify(
                provider_id,
                _make_renewer(auth, credential),
            )
        except ModelsError:
            raise
        except BaseException as error:
            # The stored credential is kept, so a re-login can fix it instead of losing it.
            raise ModelsError(
                "oauth",
                f"Failed to refresh the credential for {provider_id}",
                error,
            ) from error
        if isinstance(renewed, OAuthCredential):
            credential = renewed

    if auth.toAuth is not None:
        values = await auth.toAuth(credential)
    else:
        values = {"apiKey": credential.access}
    return AuthResult(auth=values, env=credential.env, source=f"{auth.name} (oauth)")


def _refresh_signal() -> AbortSignal | None:
    """The signal handed to a refresh, which must complete on its own."""

    return None


# A token is renewed once it is inside this window, so a request in flight cannot have its
# token expire between resolution and arrival.
MIN_OAUTH_VALIDITY_MS = 5 * 60 * 1000


def _needs_refresh(credential: OAuthCredential) -> bool:
    """Whether the token is expired or close enough to expiry to renew now."""

    if credential.expiresAt is None:
        return False
    import time

    return int(time.time() * 1000) + MIN_OAUTH_VALIDITY_MS >= credential.expiresAt


def _make_renewer(
    auth: OAuthAuth,
    credential: OAuthCredential,
) -> Callable[[Credential | None], Awaitable[Credential | None]]:
    """Wrap the renewal so the store's update can await it."""

    async def renew(current: Credential | None) -> Credential | None:
        if not isinstance(current, OAuthCredential):
            return current
        if auth.refresh is None:
            return current
        return await auth.refresh(current, _refresh_signal())

    return renew
