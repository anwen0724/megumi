"""Credential contracts independent of persistence and HTTP clients."""

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ApiKeyCredential:
    """An API key, excluded from diagnostic representations."""

    key: str = field(repr=False)


class CredentialStore(Protocol):
    """Provider-scoped async credential storage."""

    async def read(self, provider_id: str) -> ApiKeyCredential | None:
        """Read a credential; None means absent, not failed."""
        ...

    async def set(self, provider_id: str, credential: ApiKeyCredential) -> None:
        """Replace a provider credential."""
        ...

    async def delete(self, provider_id: str) -> None:
        """Remove a provider credential."""
        ...


type HeaderTransform = Callable[
    [dict[str, str]], Mapping[str, str | None] | Awaitable[Mapping[str, str | None]]
]


@dataclass(frozen=True, slots=True)
class AuthOverride:
    """Request-scoped overrides; never persisted back to a credential store."""

    api_key: str | None = field(default=None, repr=False)
    headers: Mapping[str, str | None] = field(default_factory=dict, repr=False)
    env: Mapping[str, str | None] = field(default_factory=dict, repr=False)
    base_url: str | None = None
    transform_headers: HeaderTransform | None = field(default=None, repr=False)


@dataclass(frozen=True, slots=True)
class ResolvedAuth:
    """An independent request configuration with a redacted representation."""

    key: str | None = field(repr=False)
    source: str
    base_url: str
    headers: Mapping[str, str] = field(default_factory=dict, repr=False)
    env: Mapping[str, str | None] = field(default_factory=dict, repr=False)


@dataclass(frozen=True, slots=True)
class AuthContext:
    """供应商认证读取作用域环境; 不会直接依赖进程环境。"""

    env: Callable[[str], str | None]


@dataclass(frozen=True, slots=True)
class AuthResult:
    """供应商认证解析出的凭据及请求默认值。"""

    key: str | None = field(default=None, repr=False)
    source: str = "environment"
    base_url: str | None = None
    headers: Mapping[str, str | None] = field(default_factory=dict, repr=False)
    env: Mapping[str, str | None] = field(default_factory=dict, repr=False)


class ApiKeyAuth(Protocol):
    """供应商提供的 API key 认证策略; 登录与 OAuth 不在当前范围。"""

    @property
    def name(self) -> str:
        """认证方式的名称。"""
        ...

    async def resolve(
        self, ctx: AuthContext, credential: ApiKeyCredential | None
    ) -> AuthResult | None:
        """解析存储凭据或外部来源; None 表示未配置。"""
        ...


@dataclass(frozen=True, slots=True)
class ProviderAuth:
    """Provider 组合的认证能力。"""

    api_key: ApiKeyAuth
