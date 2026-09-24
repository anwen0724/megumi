"""Compose provider identity, authentication, catalog and protocol streams."""

from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, field, replace
from typing import Protocol

from app.ai.api.base import ProviderStreams
from app.ai.auth.types import ProviderAuth
from app.ai.errors import ConfigurationError
from app.ai.messages import Transcript
from app.ai.model import Model
from app.ai.options import CallOptions, SimpleOptions
from app.ai.stream import AssistantResponse, ResponseWriter


class Provider(ProviderStreams, Protocol):
    """供应商接入契约; Models 通过它获取目录、认证并发起生成。"""

    @property
    def id(self) -> str: ...
    @property
    def name(self) -> str: ...
    @property
    def base_url(self) -> str: ...
    @property
    def headers(self) -> Mapping[str, str | None]: ...
    @property
    def auth(self) -> ProviderAuth: ...

    def get_models(self) -> Sequence[Model]:
        """返回当前模型目录。"""
        ...


@dataclass(frozen=True, slots=True)
class _ConfiguredProvider:
    """公共工厂生成的静态 Provider; 行为对象保留身份, 配置数据独立复制。"""

    id: str
    name: str
    base_url: str
    auth: ProviderAuth
    models: Sequence[Model]
    api: ProviderStreams | Mapping[str, ProviderStreams]
    headers: Mapping[str, str | None] = field(default_factory=dict)

    def get_models(self) -> tuple[Model, ...]:
        """读取独立目录快照。"""
        return tuple(deepcopy(model) for model in self.models)

    def _api_for(self, model: Model) -> ProviderStreams | None:
        return self.api.get(model.api) if isinstance(self.api, Mapping) else self.api

    def _missing_api(self, model: Model, options: CallOptions | None) -> AssistantResponse:
        async def fail(writer: ResponseWriter) -> None:
            raise ConfigurationError(
                f'Provider {self.id} has no API implementation for "{model.api}"'
            )

        return AssistantResponse(model, fail, signal=options.signal if options else None)

    def stream(
        self, model: Model, context: Transcript, options: CallOptions | None = None
    ) -> AssistantResponse:
        """单实现直接委托; 映射按 model.api 选择, 缺失通过流返回错误。"""
        implementation = self._api_for(model)
        return (
            implementation.stream(model, context, options)
            if implementation is not None
            else self._missing_api(model, options)
        )

    def stream_simple(
        self, model: Model, context: Transcript, options: SimpleOptions | None = None
    ) -> AssistantResponse:
        """简化调用保持同一供应商和协议分派规则。"""
        implementation = self._api_for(model)
        return (
            implementation.stream_simple(model, context, options)
            if implementation is not None
            else self._missing_api(model, options)
        )


def copy_provider(provider: Provider) -> Provider:
    """复制工厂配置而不复制认证/协议资源; 自定义行为对象按 pi 保留身份。"""
    if isinstance(provider, _ConfiguredProvider):
        _validate_api(provider.api)
        return replace(
            provider,
            models=provider.get_models(),
            headers=deepcopy(dict(provider.headers)),
            api=dict(provider.api) if isinstance(provider.api, Mapping) else provider.api,
        )
    return provider


def create_provider(
    *,
    id: str,
    auth: ProviderAuth,
    models: Sequence[Model],
    api: ProviderStreams | Mapping[str, ProviderStreams],
    name: str | None = None,
    base_url: str = "",
    headers: Mapping[str, str | None] | None = None,
) -> Provider:
    """按 pi 的工厂组合供应商; 协议是可执行实现, 不是全局注册名称。"""
    _validate_api(api)
    return _ConfiguredProvider(
        id=id,
        name=name or id,
        base_url=base_url,
        auth=auth,
        models=tuple(deepcopy(model) for model in models),
        api=dict(api) if isinstance(api, Mapping) else api,
        headers=deepcopy(dict(headers or {})),
    )


def _validate_api(api: ProviderStreams | Mapping[str, ProviderStreams]) -> None:
    """验证装配的是可执行协议; 映射可暂缺某个模型的实现, 调用时返回错误。"""
    if isinstance(api, Mapping):
        if any(not isinstance(key, str) or not key.strip() for key in api):
            raise ConfigurationError("Invalid API implementation map")
        implementations = tuple(api.values())
    else:
        implementations = (api,)
    if any(
        not callable(getattr(item, "stream", None))
        or not callable(getattr(item, "stream_simple", None))
        for item in implementations
    ):
        raise ConfigurationError("Expected executable API implementation")
