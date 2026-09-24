"""Compose Responses encoding and parsing with the shared authenticated SDK runtime."""

from dataclasses import replace
from typing import cast

from openai import AsyncOpenAI, AsyncStream
from openai.types.responses import ResponseInputParam, ResponseStreamEvent

from app.ai.api.base import ProviderStreams
from app.ai.api.openai_runtime import OpenAIProtocol
from app.ai.api.responses.options import ResponsesOptions, from_simple
from app.ai.api.responses.request import build_request
from app.ai.api.responses.response import consume_response
from app.ai.auth.types import ResolvedAuth
from app.ai.messages import JSONValue, Transcript
from app.ai.model import Model
from app.ai.options import CallOptions, SimpleOptions
from app.ai.runtime.clients import ClientRuntime, StreamRequestOptions
from app.ai.stream import ResponseWriter


async def create_stream(
    client: AsyncOpenAI, payload: dict[str, JSONValue], request_options: StreamRequestOptions
) -> AsyncStream[ResponseStreamEvent]:
    """Use responses.create and preserve the final payload, including extension fields."""
    return await client.responses.create(
        model=cast(str, payload["model"]),
        input=cast(ResponseInputParam, payload["input"]),
        stream=True,
        extra_body=payload,
        **request_options,
    )


class ResponsesApi(OpenAIProtocol):
    """Expose Responses streams through the provider-bound protocol interface."""

    options_type = ResponsesOptions

    def request_headers(self, model: Model, options: CallOptions, base_url: str) -> dict[str, str]:
        """Provide protocol defaults before applying the prepared request header overrides."""
        if not options.session_id or model.compat.send_session_affinity_headers is False:
            return {}
        form = model.compat.session_affinity_format or (
            "openrouter"
            if model.provider == "openrouter" or "openrouter.ai" in base_url.lower()
            else "openai"
        )
        if form == "openrouter":
            return {"x-session-id": options.session_id}
        headers = {"x-client-request-id": options.session_id}
        if form == "openai":
            headers["session_id"] = options.session_id
        return headers

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
        """Execute explicit protocol options through the shared request lifecycle."""
        assert isinstance(options, ResponsesOptions)
        request_tier: str | None = None

        async def operation(
            client: AsyncOpenAI,
            payload: dict[str, JSONValue],
            request_options: StreamRequestOptions,
        ) -> AsyncStream[ResponseStreamEvent]:
            """Capture the final wire tier after sampling overrides and the payload hook."""
            nonlocal request_tier
            tier = payload.get("service_tier")
            request_tier = tier if isinstance(tier, str) else None
            return await create_stream(client, payload, request_options)

        stream = await clients.open_stream(
            operation,
            build_request(model, transcript, options),
            model=model,
            auth=auth,
            options=options,
            writer=writer,
        )
        await consume_response(stream, writer, replace(model, base_url=auth.base_url), request_tier)

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
        """Map prepared simple controls before running the same protocol path."""
        await self._produce(
            model=model,
            transcript=transcript,
            options=from_simple(options),
            auth=auth,
            clients=clients,
            writer=writer,
        )


def openai_responses_api() -> ProviderStreams:
    """返回可由多个供应商共同使用的协议实现。"""
    return ResponsesApi()
