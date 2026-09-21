"""Translate native Responses events into the shared assistant stream."""

from collections.abc import AsyncIterable
from typing import cast

from openai import BaseModel

from app.ai.messages import JSONValue, TextContent
from app.ai.stream import ResponseWriter


async def consume_response(events: AsyncIterable[object], writer: ResponseWriter) -> None:
    """Require an overall terminal event, not just completed text."""
    partial = writer.partial
    block: TextContent | None = None
    terminal = False
    writer.emit({"type": "start", "partial": partial})
    async for native in events:
        if not isinstance(native, BaseModel):
            continue
        event = cast(dict[str, JSONValue], native.model_dump(mode="json"))
        kind = event.get("type")
        response = event.get("response")
        if isinstance(response, dict):
            identity, model = response.get("id"), response.get("model")
            if isinstance(identity, str):
                partial.response_id = partial.response_id or identity
            if isinstance(model, str) and model != partial.model:
                partial.response_model = partial.response_model or model
        if kind == "response.output_item.added":
            block = TextContent(text="")
            partial.content.append(block)
            writer.emit({"type": "text_start", "content_index": 0, "partial": partial})
        elif kind == "response.output_text.delta" and block is not None:
            delta = event.get("delta")
            if not isinstance(delta, str):
                raise ValueError("Invalid Responses text delta")
            block.text += delta
            writer.emit(
                {"type": "text_delta", "content_index": 0, "delta": delta, "partial": partial}
            )
        elif kind == "response.output_item.done" and block is not None:
            writer.emit(
                {"type": "text_end", "content_index": 0, "content": block.text, "partial": partial}
            )
        elif kind == "response.completed":
            terminal = True
    if not terminal:
        raise ValueError("Responses stream ended without a terminal response event")
    partial.raw_stop_reason = "completed"
    writer.emit({"type": "done", "reason": "stop", "message": partial})
