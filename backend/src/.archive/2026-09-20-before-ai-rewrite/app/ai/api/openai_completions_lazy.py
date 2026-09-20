"""The completions protocol as a provider sees it.

A provider hands back this stream contract without importing the protocol module, so
importing a provider definition stays cheap and the parsing code loads on the first request.
"""

from __future__ import annotations

from app.ai.api.lazy import lazyApi
from app.ai.api.sse_transport import open_sse_chunk_stream
from app.ai.models import ProviderStreams
from app.ai.types import (
    Model,
    OpenAICompletionsOptions,
    SimpleStreamOptions,
    StreamOptions,
    TranscriptContext,
)
from app.ai.utils.event_stream import AssistantMessageEventStream

__all__ = ["openAICompletionsApi"]


async def _load() -> ProviderStreams:
    """Import the protocol module and bind it to the streaming HTTP transport."""

    from app.ai.api import openai_completions as implementation

    def stream(
        model: Model,
        context: TranscriptContext,
        options: StreamOptions | None = None,
    ) -> AssistantMessageEventStream:
        completions_options = (
            options if isinstance(options, OpenAICompletionsOptions) else None
        )
        return implementation.stream(model, context, completions_options, open_sse_chunk_stream)

    def stream_simple(
        model: Model,
        context: TranscriptContext,
        options: SimpleStreamOptions | None = None,
    ) -> AssistantMessageEventStream:
        return implementation.stream_simple(model, context, options, open_sse_chunk_stream)

    return ProviderStreams(stream=stream, streamSimple=stream_simple)


def openAICompletionsApi() -> ProviderStreams:
    """The stream contract for the OpenAI-compatible completions protocol."""

    return lazyApi(_load)
