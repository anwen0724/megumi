"""The auth methods most providers use.

Most providers need the same two things: a key that may come from a stored credential or
from the environment, and an interactive flow that asks for it. This module supplies both
so a provider definition stays a few lines. A provider whose resolution is unusual — one
that reads a provider-scoped environment, an ambient credential file, or a cloud instance
role — writes its own resolver instead of using these.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from app.ai.auth.types import (
    ApiKeyAuth,
    ApiKeyCredential,
    AuthInteraction,
    AuthPrompt,
    AuthRequest,
    AuthResult,
    Credential,
    OAuthAuth,
    OAuthCredential,
)
from app.ai.utils.abort import AbortSignal, abort_reason

__all__ = ["env_api_key_auth", "lazy_oauth"]


def _check_aborted(signal: AbortSignal | None) -> None:
    """Raise when the interactive flow has already been abandoned."""

    if signal is None or not signal.aborted:
        return
    reason = abort_reason(signal)
    if isinstance(reason, BaseException):
        raise reason
    raise RuntimeError(str(reason))


def env_api_key_auth(name: str, env_vars: list[str]) -> ApiKeyAuth:
    """Key auth that prefers a stored credential, then the first set environment variable.

    The order matters: once a key is stored, the environment is not consulted, so a login is
    not silently overridden by a variable left over from an earlier setup.
    """

    async def login(interaction: AuthInteraction) -> Credential:
        """Ask the user for the key."""

        _check_aborted(interaction.signal)
        key = await interaction.prompt(AuthPrompt(type="secret", message=f"Enter {name}"))
        _check_aborted(interaction.signal)
        return ApiKeyCredential(key=key)

    async def resolve(request: AuthRequest) -> AuthResult | None:
        """The request values for a stored key, else the first environment variable that is set."""

        credential = request.credential
        if isinstance(credential, ApiKeyCredential) and credential.key:
            return AuthResult(
                auth={"apiKey": credential.key},
                env=credential.env,
                source="stored credential",
            )
        for env_var in env_vars:
            value = await request.ctx.env(env_var)
            if value:
                return AuthResult(auth={"apiKey": value}, source=env_var)
        return None

    return ApiKeyAuth(name=name, resolve=resolve, login=login)


def lazy_oauth(
    name: str,
    load: Callable[[], Awaitable[OAuthAuth]],
    is_subscription: bool | None = None,
    login_label: str | None = None,
) -> OAuthAuth:
    """An OAuth method whose flow loads on first use.

    A provider can advertise OAuth without importing the flow, which keeps a large,
    rarely-used module out of the path of a request that only needs a key. The flow is
    loaded once and remembered.
    """

    loaded: list[OAuthAuth] = []

    async def resolve_flow() -> OAuthAuth:
        if not loaded:
            loaded.append(await load())
        return loaded[0]

    async def login(interaction: AuthInteraction) -> Credential:
        flow = await resolve_flow()
        return await flow.login(interaction)

    async def refresh(credential: OAuthCredential, signal: AbortSignal | None) -> OAuthCredential:
        flow = await resolve_flow()
        if flow.refresh is None:
            raise RuntimeError(f"{name} cannot refresh a credential")
        return await flow.refresh(credential, signal)

    async def to_auth(credential: OAuthCredential) -> dict[str, object]:
        flow = await resolve_flow()
        if flow.toAuth is None:
            return {"apiKey": credential.access}
        return await flow.toAuth(credential)

    return OAuthAuth(
        name=name,
        login=login,
        refresh=refresh,
        to_auth=to_auth,
        is_subscription=is_subscription,
        login_label=login_label,
    )
