"""Credential, auth and login contracts.

A provider's auth is not one thing but three. *Resolving* turns whatever the environment
and the credential store hold into a request-scoped result: the values to send, and a label
saying where they came from. *Login* runs an interactive flow and produces a credential to
store. *Refresh* renews a credential that has expired. A provider may offer only the first,
which is what a key read from the environment needs.

The credential is stored, not the resolved result: a stored credential belongs to the
provider that issued it, so it also records which environment values it expects.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal, Protocol, runtime_checkable

from app.ai.types import ProviderEnv
from app.ai.utils.abort import AbortSignal

__all__ = [
    "ApiKeyAuth",
    "AuthCheck",
    "AuthContext",
    "AuthInteraction",
    "AuthOperationOptions",
    "AuthPrompt",
    "AuthResult",
    "AuthType",
    "Credential",
    "CredentialStore",
    "EnvFunction",
    "InMemoryCredentialStore",
    "OAuthAuth",
    "OAuthCredential",
    "ProviderAuth",
    "StoredAuth",
]


class AuthType(StrEnum):
    """Which of a provider's auth methods a caller means."""

    API_KEY = "api_key"
    OAUTH = "oauth"


@dataclass(slots=True)
class ApiKeyCredential:
    """A key the caller entered or that was read from the environment."""

    key: str
    type: Literal["api_key"] = "api_key"
    env: ProviderEnv | None = None


@dataclass(slots=True)
class OAuthCredential:
    """A token set obtained by an interactive flow.

    ``expiresAt`` is a Unix timestamp in milliseconds; a credential without one never
    expires on its own.
    """

    access: str
    refresh: str | None = None
    expiresAt: int | None = None
    type: Literal["oauth"] = "oauth"
    env: ProviderEnv | None = None
    accountId: str | None = None
    enterpriseUrl: str | None = None
    projectId: str | None = None
    email: str | None = None
    metadata: dict[str, Any] | None = None


Credential = ApiKeyCredential | OAuthCredential


@dataclass(slots=True)
class AuthPrompt:
    """A question a login flow asks the user."""

    type: Literal["text", "secret", "select"]
    message: str
    options: list[dict[str, str]] | None = None
    placeholder: str | None = None


@dataclass(slots=True)
class AuthInteraction:
    """The channel a login flow uses to ask the user something.

    ``signal`` is checked around every prompt so a login can be abandoned without leaving a
    flow waiting on input that will never arrive.
    """

    prompt: Callable[[AuthPrompt], Awaitable[str]]
    signal: AbortSignal | None = None
    notify: Callable[[str], None] | None = None


@dataclass(slots=True)
class AuthOperationOptions:
    """How an auth operation may cancel and what it may look at."""

    signal: AbortSignal | None = None


@dataclass(slots=True)
class AuthResult:
    """The values to send for one request, and where they came from."""

    auth: dict[str, Any]
    source: str
    env: ProviderEnv | None = None


@dataclass(slots=True)
class AuthCheck:
    """Whether a provider is configured, without performing a refresh."""

    configured: bool
    source: str | None = None
    credential: Credential | None = None


@dataclass(slots=True)
class StoredAuth:
    """What the credential store holds for one provider."""

    credential: Credential | None = None


EnvFunction = Callable[[str], Awaitable[str | None]]


@runtime_checkable
class AuthContext(Protocol):
    """The environment a provider resolves against."""

    def env(self, name: str) -> Awaitable[str | None]:
        """The value of an environment variable, or ``None``."""
        ...

    def fileExists(self, path: str) -> Awaitable[bool]:
        """Whether a file exists, for providers that read a credential an SDK wrote."""
        ...


@runtime_checkable
class CredentialStore(Protocol):
    """Where provider credentials are kept between runs."""

    def read(self, provider: str) -> Awaitable[Credential | None]:
        """The stored credential for ``provider``, if any."""
        ...

    def write(self, provider: str, credential: Credential | None) -> Awaitable[None]:
        """Store ``credential``, or remove the entry when it is ``None``."""
        ...

    def modify(
        self,
        provider: str,
        update: Callable[[Credential | None], Awaitable[Credential | None]],
    ) -> Awaitable[Credential | None]:
        """Read, update and write under a lock, so a refresh cannot race another."""
        ...


class InMemoryCredentialStore:
    """A credential store that keeps credentials for the life of the process."""

    def __init__(self) -> None:
        self._credentials: dict[str, Credential] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def read(self, provider: str) -> Credential | None:
        return self._credentials.get(provider)

    async def write(self, provider: str, credential: Credential | None) -> None:
        if credential is None:
            self._credentials.pop(provider, None)
        else:
            self._credentials[provider] = credential

    async def modify(
        self,
        provider: str,
        update: Callable[[Credential | None], Awaitable[Credential | None]],
    ) -> Credential | None:
        # Renaming a key or replacing the entry is one step from the caller's point of view,
        # so a concurrent refresh cannot interleave with this one.
        async with self._lock_for(provider):
            updated = await update(self._credentials.get(provider))
            await self.write(provider, updated)
            return updated

    def _lock_for(self, provider: str) -> asyncio.Lock:
        """The lock that serialises modifications for one provider."""

        lock = self._locks.get(provider)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[provider] = lock
        return lock


class ApiKeyAuth:
    """Auth that resolves a key from the caller, a stored credential, or the environment."""

    def __init__(
        self,
        name: str,
        resolve: Callable[[AuthRequest], Awaitable[AuthResult | None]],
        login: Callable[[AuthInteraction], Awaitable[Credential]] | None = None,
    ) -> None:
        self.name = name
        self.resolve = resolve
        self.login = login


class OAuthAuth:
    """Auth backed by an interactive flow, with renewal."""

    def __init__(
        self,
        name: str,
        login: Callable[[AuthInteraction], Awaitable[Credential]],
        refresh: Callable[[OAuthCredential, AbortSignal | None], Awaitable[OAuthCredential]]
        | None = None,
        to_auth: Callable[[OAuthCredential], Awaitable[dict[str, object]]] | None = None,
        is_subscription: bool | None = None,
        login_label: str | None = None,
    ) -> None:
        self.name = name
        self.login = login
        self.refresh = refresh
        self.toAuth = to_auth
        self.isSubscription = is_subscription
        self.loginLabel = login_label


@dataclass(slots=True)
class ProviderAuth:
    """The auth methods a provider offers. At least one is always present."""

    api_key: ApiKeyAuth | None = None
    oauth: OAuthAuth | None = None

    @property
    def declared(self) -> list[str]:
        """The method names this provider offers."""

        names: list[str] = []
        if self.api_key is not None:
            names.append("api_key")
        if self.oauth is not None:
            names.append("oauth")
        return names


@dataclass(slots=True)
class AuthRequest:
    """What a resolve call is given: the environment, the credential, and a signal."""

    ctx: AuthContext
    credential: Credential | None = None
    signal: AbortSignal | None = None


@dataclass(slots=True)
class AuthResolutionOverrides:
    """Request-scoped overrides that take precedence over anything stored."""

    apiKey: str | None = None
    env: ProviderEnv | None = field(default=None)
