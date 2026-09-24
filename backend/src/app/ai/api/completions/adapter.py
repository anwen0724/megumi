"""Bind protocol encoding and parsing to the shared authenticated SDK runtime."""

from dataclasses import fields, replace
from typing import cast

from openai import AsyncOpenAI, AsyncStream
from openai.types.chat import ChatCompletionChunk, ChatCompletionMessageParam

from app.ai.api.base import ProviderStreams
from app.ai.api.completions.options import CompletionsOptions, from_simple
from app.ai.api.completions.request import build_request
from app.ai.api.completions.response import consume_response
from app.ai.api.openai_runtime import OpenAIProtocol
from app.ai.auth.types import ResolvedAuth
from app.ai.messages import JSONValue, Transcript
from app.ai.model import Model, ModelCompat
from app.ai.options import CallOptions, SimpleOptions
from app.ai.runtime.clients import ClientRuntime, StreamRequestOptions
from app.ai.stream import ResponseWriter


async def create_stream(
    client: AsyncOpenAI, payload: dict[str, JSONValue], request_options: StreamRequestOptions
) -> AsyncStream[ChatCompletionChunk]:
    """Use the typed SDK entry while preserving the complete final payload as extra body."""
    # Required SDK arguments are read from the payload, not invented defaults.
    # extra_body preserves native extension fields and hook replacements.
    return await client.chat.completions.create(
        model=cast(str, payload["model"]),
        messages=cast(list[ChatCompletionMessageParam], payload["messages"]),
        stream=True,
        extra_body=payload,
        **request_options,
    )


class CompletionsApi(OpenAIProtocol):
    """Execute Chat Completions for any configured provider using this protocol."""

    options_type = CompletionsOptions

    def request_headers(self, model: Model, options: CallOptions, base_url: str) -> dict[str, str]:
        """Provide protocol defaults before applying the prepared request header overrides."""
        compat = resolve_compat(model, base_url)
        if (
            not options.session_id
            or options.cache_retention == "none"
            or not compat.send_session_affinity_headers
        ):
            return {}
        if compat.session_affinity_format == "openrouter":
            return {"x-session-id": options.session_id}
        headers = {
            "x-client-request-id": options.session_id,
            "x-session-affinity": options.session_id,
        }
        if compat.session_affinity_format in (None, "openai"):
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
        """Encode and execute an explicit protocol call."""
        assert isinstance(options, CompletionsOptions)
        effective = replace(
            model, base_url=auth.base_url, compat=resolve_compat(model, auth.base_url)
        )
        chunks = await clients.open_stream(
            create_stream,
            build_request(effective, transcript, options),
            model=model,
            auth=auth,
            options=options,
            writer=writer,
        )
        await consume_response(chunks, writer, effective)

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
        """Execute prepared simple options through the same request path."""
        await self._produce(
            model=model,
            transcript=transcript,
            options=from_simple(options),
            auth=auth,
            clients=clients,
            writer=writer,
        )


def resolve_compat(model: Model, base_url: str) -> ModelCompat:
    """Apply only supported protocol/DeepSeek defaults, then explicit model overrides."""
    deepseek = model.provider == "deepseek" or "deepseek.com" in base_url.lower()
    detected = ModelCompat(
        supports_long_cache_retention=True,
        supports_reasoning_effort=True,
        thinking_format="deepseek" if deepseek else "openai",
        requires_reasoning_content_on_assistant_messages=deepseek,
        supports_developer_role=not deepseek,
        supports_store=not deepseek,
        supports_usage_in_streaming=True,
        max_tokens_field="max_tokens" if deepseek else "max_completion_tokens",
    )
    return replace(
        detected,
        **{
            field.name: getattr(model.compat, field.name)
            for field in fields(ModelCompat)
            if getattr(model.compat, field.name) is not None
        },
    )


def openai_completions_api() -> ProviderStreams:
    """返回可由多个供应商共同使用的协议实现。"""
    return CompletionsApi()
