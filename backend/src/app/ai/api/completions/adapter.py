"""Bind protocol encoding and parsing to the shared authenticated SDK runtime."""

from typing import cast

from openai import AsyncOpenAI, AsyncStream
from openai.types.chat import ChatCompletionChunk, ChatCompletionMessageParam

from app.ai.api.completions.options import CompletionsOptions
from app.ai.api.completions.request import build_request
from app.ai.api.completions.response import consume_response
from app.ai.auth.types import ResolvedAuth
from app.ai.messages import JSONValue, Transcript
from app.ai.model import Model
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


class CompletionsAdapter:
    """Execute Chat Completions for any configured provider using this protocol."""

    options_type = CompletionsOptions

    async def stream(
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
        chunks = await clients.open_stream(
            create_stream,
            build_request(model, transcript),
            model=model,
            auth=auth,
            options=options,
            writer=writer,
        )
        await consume_response(chunks, writer)

    async def stream_simple(
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
        await self.stream(
            model=model,
            transcript=transcript,
            options=options,
            auth=auth,
            clients=clients,
            writer=writer,
        )
