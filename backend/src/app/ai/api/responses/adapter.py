"""Compose Responses encoding and parsing with the shared authenticated SDK runtime."""

from typing import cast

from openai import AsyncOpenAI, AsyncStream
from openai.types.responses import ResponseInputParam, ResponseStreamEvent

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


class ResponsesAdapter:
    """Execute Responses for configured providers without owning a second response task."""

    options_type = ResponsesOptions

    def request_headers(self, model: Model, options: CallOptions, base_url: str) -> dict[str, str]:
        """Provide session defaults before shared provider/model/caller header precedence."""
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
        """Execute explicit protocol options through the shared request lifecycle."""
        assert isinstance(options, ResponsesOptions)
        stream = await clients.open_stream(
            create_stream,
            build_request(model, transcript, options),
            model=model,
            auth=auth,
            options=options,
            writer=writer,
        )
        await consume_response(stream, writer)

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
        """Map prepared simple controls before running the same protocol path."""
        await self.stream(
            model=model,
            transcript=transcript,
            options=from_simple(options),
            auth=auth,
            clients=clients,
            writer=writer,
        )
