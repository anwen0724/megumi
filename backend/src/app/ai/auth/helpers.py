"""Reusable environment API-key authentication for provider composition."""

from collections.abc import Sequence
from dataclasses import dataclass

from app.ai.auth.types import ApiKeyAuth, ApiKeyCredential, AuthContext, AuthResult
from app.ai.errors import AuthError


def validate_api_key(key: str) -> str:
    """只检查本地凭据格式, 不宣称远端凭据有效。"""
    if not isinstance(key, str) or not key.strip() or "\r" in key or "\n" in key:
        raise AuthError("invalid_credential")
    return key


@dataclass(frozen=True, slots=True)
class _EnvApiKeyAuth:
    name: str
    env_vars: tuple[str, ...]

    async def resolve(
        self, ctx: AuthContext, credential: ApiKeyCredential | None
    ) -> AuthResult | None:
        """已存凭据优先, 其次依次读取配置的环境变量。"""
        if credential is not None:
            return AuthResult(key=validate_api_key(credential.key), source="stored")
        for name in self.env_vars:
            value = ctx.env(name)
            if value is not None and value.strip():
                return AuthResult(key=validate_api_key(value), source="environment")
        return None


def env_api_key_auth(name: str, env_vars: Sequence[str]) -> ApiKeyAuth:
    """对齐 pi envApiKeyAuth, 供多家供应商复用环境变量认证。"""
    return _EnvApiKeyAuth(name=name, env_vars=tuple(env_vars))
