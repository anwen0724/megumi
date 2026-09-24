"""Resolve one request's credentials and configuration without mutating sources."""

import os
from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import replace
from inspect import isawaitable

from app.ai.auth.helpers import validate_api_key
from app.ai.auth.types import (
    ApiKeyCredential,
    AuthContext,
    AuthOverride,
    AuthResult,
    CredentialStore,
    ResolvedAuth,
)
from app.ai.catalog import validate_headers, validate_url
from app.ai.errors import AuthError, ConfigurationError
from app.ai.model import Model
from app.ai.provider import Provider, copy_provider


async def resolve_auth(
    provider: Provider,
    model: Model,
    overrides: AuthOverride | None = None,
    *,
    credentials: CredentialStore,
    env_read: Callable[[str], str | None] | None = None,
) -> ResolvedAuth:
    """Resolve an independent request configuration; never contact a provider."""
    provider, model = copy_provider(provider), deepcopy(model)
    original = overrides or AuthOverride()
    # 只复制配置数据。回调保留身份, 不复制其持有的状态或外部资源。
    overrides = replace(original, headers=dict(original.headers), env=dict(original.env))
    if model.provider != provider.id:
        raise ConfigurationError("Model does not match provider identity or protocol")
    endpoint = model.base_url if model.base_url is not None else provider.base_url
    if overrides.base_url is not None:
        endpoint = overrides.base_url
    validate_url(endpoint)
    if not isinstance(overrides.env, Mapping) or any(
        not isinstance(name, str) or (value is not None and not isinstance(value, str))
        for name, value in overrides.env.items()
    ):
        raise ConfigurationError("Invalid scoped environment")
    result = await resolve_provider_auth(provider, overrides, credentials, env_read)
    key = result.key if result else None
    source = result.source if result else "headers"
    if result and result.base_url is not None and overrides.base_url is None:
        endpoint = result.base_url
        validate_url(endpoint)
    headers = merge_headers(
        provider.headers,
        model.headers,
        {"authorization": f"Bearer {key}"} if key is not None else {},
        result.headers if result else {},
        overrides.headers,
    )
    if overrides.transform_headers is not None:
        transformed = overrides.transform_headers(dict(headers))
        final_headers = await transformed if isawaitable(transformed) else transformed
        headers = merge_headers(final_headers)
    if key is None and not has_auth_header(headers):
        raise AuthError("not_configured")
    return ResolvedAuth(
        key=key,
        source=source,
        base_url=endpoint,
        headers=headers,
        env={**(result.env if result else {}), **overrides.env},
    )


def merge_headers(*layers: Mapping[str, str | None]) -> dict[str, str]:
    """按顺序合并并规范化大小写。None 删除既有头。"""
    headers: dict[str, str] = {}
    for layer in layers:
        validate_headers(layer)
        for name, value in layer.items():
            if value is None:
                headers.pop(name.lower(), None)
            else:
                headers[name.lower()] = value
    return headers


def has_auth_header(headers: Mapping[str, str]) -> bool:
    """两种已接协议使用 Authorization。这里只判断本地配置是否存在。"""
    return bool(headers.get("authorization", "").strip())


async def resolve_provider_auth(
    provider: Provider,
    overrides: AuthOverride,
    credentials: CredentialStore,
    env_read: Callable[[str], str | None] | None = None,
) -> AuthResult | None:
    """公共流程读取凭据; 供应商策略负责如何解析, 不写供应商条件分支。"""
    if overrides.api_key is not None:
        return AuthResult(key=validate_api_key(overrides.api_key), source="explicit")
    try:
        credential = await credentials.read(provider.id)
    except Exception:
        raise AuthError("credential_store_error") from None
    if credential is not None:
        if not isinstance(credential, ApiKeyCredential):
            raise AuthError("invalid_credential")
        validate_api_key(credential.key)

    def env(name: str) -> str | None:
        return overrides.env[name] if name in overrides.env else (env_read or os.getenv)(name)

    result = await provider.auth.api_key.resolve(AuthContext(env=env), credential)
    if result is not None and result.key is not None:
        validate_api_key(result.key)
    return result
