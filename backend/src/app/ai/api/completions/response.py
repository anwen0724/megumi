"""Translate native SDK chunks into shared assistant events."""

from collections.abc import AsyncIterable

from openai.types.chat import ChatCompletionChunk

from app.ai.messages import TextContent
from app.ai.stream import ResponseWriter


async def consume_response(
    chunks: AsyncIterable[ChatCompletionChunk], writer: ResponseWriter
) -> None:
    """Read to EOF so a finish marker never truncates the response body."""
    partial = writer.partial
    text: TextContent | None = None
    writer.emit({"type": "start", "partial": partial})
    async for chunk in chunks:
        partial.response_id = partial.response_id or chunk.id
        if chunk.model and chunk.model != partial.model:
            partial.response_model = partial.response_model or chunk.model
        if not chunk.choices:
            continue
        choice = chunk.choices[0]
        if choice.finish_reason == "stop":
            partial.stop_reason = "stop"
            partial.raw_stop_reason = "stop"
        if choice.delta and choice.delta.content:
            if text is None:
                text = TextContent(text="")
                partial.content.append(text)
                writer.emit({"type": "text_start", "content_index": 0, "partial": partial})
            text.text += choice.delta.content
            writer.emit(
                {
                    "type": "text_delta",
                    "content_index": 0,
                    "delta": choice.delta.content,
                    "partial": partial,
                }
            )
    if text is not None:
        writer.emit(
            {"type": "text_end", "content_index": 0, "content": text.text, "partial": partial}
        )
    if partial.stop_reason != "stop":
        raise ValueError("Stream ended without finish_reason")
    writer.emit({"type": "done", "reason": "stop", "message": partial})
