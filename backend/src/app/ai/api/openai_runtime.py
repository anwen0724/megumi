"""OpenAI protocol execution support; not part of the ProviderStreams contract."""

from copy import deepcopy
from dataclasses import fields

from app.ai.api.simple_options import prepare_simple_options
from app.ai.auth.resolve import has_auth_header, merge_headers
from app.ai.auth.types import ResolvedAuth
from app.ai.errors import AuthError
from app.ai.messages import Transcript
from app.ai.model import Model
from app.ai.options import CallOptions, SimpleOptions, prepare_call_options
from app.ai.runtime.clients import ClientRuntime
from app.ai.stream import AssistantResponse, ResponseWriter


class OpenAIProtocol:
    """两种 OpenAI 协议复用请求生命周期; 其他协议无需继承或依赖它。"""

    options_type: type[CallOptions] = CallOptions

    def stream(
        self, model: Model, context: Transcript, options: CallOptions | None = None
    ) -> AssistantResponse:
        """协议自行解释原生选项并返回响应流。"""
        if options is None:
            options = self.options_type()
        elif type(options) is CallOptions and self.options_type is not CallOptions:
            options = self.options_type(
                **{f.name: getattr(options, f.name) for f in fields(options)}
            )
        if not isinstance(options, self.options_type):
            raise TypeError(f"Expected {self.options_type.__name__}")
        return self._start(model, context, options, simple=False)

    def stream_simple(
        self, model: Model, context: Transcript, options: SimpleOptions | None = None
    ) -> AssistantResponse:
        """协议将简化选项转换到自己的请求形式。"""
        return self._start(model, context, options or SimpleOptions(), simple=True)

    def request_headers(self, model: Model, options: CallOptions, base_url: str) -> dict[str, str]:
        """协议默认请求头; 调用方已有请求头优先。"""
        return {}

    def _start(
        self, model: Model, context: Transcript, options: CallOptions, *, simple: bool
    ) -> AssistantResponse:
        model, context = deepcopy((model, context))
        options = prepare_call_options(model, options)
        if simple:
            assert isinstance(options, SimpleOptions)
            options = prepare_simple_options(model, context, options)

        async def produce(writer: ResponseWriter) -> None:
            endpoint = options.base_url or model.base_url or ""
            headers = merge_headers(
                self.request_headers(model, options, endpoint),
                model.headers,
                {"authorization": f"Bearer {options.api_key}"} if options.api_key else {},
                options.headers,
            )
            if options.api_key is None and not has_auth_header(headers):
                raise AuthError("not_configured")
            auth = ResolvedAuth(
                key=options.api_key,
                source="explicit",
                base_url=endpoint,
                headers=headers,
                env=options.env,
            )
            clients = ClientRuntime()
            writer.add_cleanup(clients.aclose)
            if simple:
                assert isinstance(options, SimpleOptions)
                await self._produce_simple(
                    model=model,
                    transcript=context,
                    options=options,
                    auth=auth,
                    clients=clients,
                    writer=writer,
                )
            else:
                await self._produce(
                    model=model,
                    transcript=context,
                    options=options,
                    auth=auth,
                    clients=clients,
                    writer=writer,
                )

        return AssistantResponse(model, produce, signal=options.signal)

    async def _produce(
        self,
        *,
        model: Model,
        transcript: Transcript,
        options: CallOptions,
        auth: ResolvedAuth,
        clients: ClientRuntime,
        writer: ResponseWriter,
    ) -> None:
        """子类用协议 SDK 操作、请求转换和响应解析完成生成。"""
        raise NotImplementedError

    async def _produce_simple(
        self,
        *,
        model: Model,
        transcript: Transcript,
        options: SimpleOptions,
        auth: ResolvedAuth,
        clients: ClientRuntime,
        writer: ResponseWriter,
    ) -> None:
        """子类在这里映射 reasoning 等协议选项。"""
        await self._produce(
            model=model,
            transcript=transcript,
            options=options,
            auth=auth,
            clients=clients,
            writer=writer,
        )
