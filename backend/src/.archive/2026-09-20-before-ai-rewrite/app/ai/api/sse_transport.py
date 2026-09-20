"""Sending a completion request and reading the server's stream back.

The response is a stream of server-sent events, each carrying one JSON object, ended by a
literal ``[DONE]`` line. A network read does not respect line boundaries, so the reader
buffers the text and only hands over lines it has received in full; whatever follows the last
newline is held until more arrives. That is what keeps a chunk from being parsed as truncated
JSON just because a packet ended in the middle of it.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping
from typing import Any

import httpx

from app.ai.api.openai_completions import ChunkStreamFactory, OpenedStream, StreamRequest
from app.ai.types import ProviderResponse

__all__ = ["SseChunkStream", "ensure_transport", "open_sse_chunk_stream"]

# The marker a server sends instead of a payload to end the stream.
_DONE = "[DONE]"


async def open_sse_chunk_stream(request: StreamRequest) -> OpenedStream:
    """Send ``request`` and return the response together with its decoded chunks.

    The response is opened here so its status and headers are available before any chunk is
    consumed, which is what lets a caller report a failure response properly.
    """

    client = httpx.AsyncClient(timeout=None)
    try:
        opened = await client.send(
            client.build_request(
                "POST",
                request.url,
                headers=_request_headers(request),
                json=dict(request.body),
            ),
            stream=True,
        )
    except BaseException:
        await client.aclose()
        raise

    if opened.status_code >= 400:
        body = await opened.aread()
        await opened.aclose()
        await client.aclose()
        raise httpx.HTTPStatusError(
            _status_message(opened.status_code, body),
            request=opened.request,
            response=opened,
        )

    return OpenedStream(
        response=ProviderResponse(
            status=opened.status_code,
            headers={name: value for name, value in opened.headers.items()},
        ),
        chunks=SseChunkStream(opened, client),
    )


def _request_headers(request: StreamRequest) -> dict[str, str]:
    """The headers to send, including the bearer token when a key was resolved.

    A caller that already set an authorization header keeps it, so a provider whose scheme is
    not a bearer token is not overridden.
    """

    headers = dict(request.headers)
    if any(name.lower() == "authorization" for name in headers):
        return headers
    api_key = request.options.apiKey if request.options is not None else None
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _status_message(status: int, body: bytes) -> str:
    """A readable failure, preferring the server's own body over the bare status."""

    text = body.decode("utf-8", errors="replace").strip()
    if not text:
        return f"{status} status code (no body)"
    return f"{status}: {text}"


class SseChunkStream:
    """Decodes a server-sent event stream into the JSON objects it carries.

    The connection is released when the stream ends or fails, so a caller that abandons the
    iteration part-way still frees it.
    """

    def __init__(self, response: httpx.Response, client: httpx.AsyncClient) -> None:
        self._response = response
        self._client = client
        self._iterator: AsyncIterator[Mapping[str, Any]] | None = None

    def __aiter__(self) -> AsyncIterator[Mapping[str, Any]]:
        return self

    async def __anext__(self) -> Mapping[str, Any]:
        """The next chunk, raising ``StopAsyncIteration`` once the stream ends."""

        if self._iterator is None:
            self._iterator = self._iterate()
        return await self._iterator.__anext__()

    async def _iterate(self) -> AsyncIterator[Mapping[str, Any]]:
        buffer = ""
        try:
            async for text in self._response.aiter_text():
                buffer += text
                # Only complete lines are consumed; whatever follows the last newline is held
                # until more text arrives.
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    payload = _payload(line)
                    if payload is None:
                        continue
                    if payload == _DONE:
                        return
                    chunk = _decode(payload)
                    if chunk is not None:
                        yield chunk
            # A stream that ends without a final newline still has one last event in it.
            for line in buffer.split("\n"):
                payload = _payload(line)
                if payload is None or payload == _DONE:
                    continue
                chunk = _decode(payload)
                if chunk is not None:
                    yield chunk
        finally:
            await self._response.aclose()
            await self._client.aclose()


def _payload(line: str) -> str | None:
    """The data a server-sent event line carries, or ``None`` for any other line.

    Comment lines start with a colon and carry keep-alive traffic. The event name and id
    fields are not needed, because what a payload is lives inside the JSON.
    """

    trimmed = line.rstrip("\r")
    if not trimmed.startswith("data:"):
        return None
    return trimmed[len("data:") :].strip()


def _decode(payload: str) -> Mapping[str, Any] | None:
    """Parse one event payload, ignoring one that is not a JSON object."""

    if not payload:
        return None
    try:
        value = json.loads(payload)
    except ValueError:
        return None
    return value if isinstance(value, Mapping) else None


def ensure_transport(factory: ChunkStreamFactory | None) -> ChunkStreamFactory:
    """The transport to use, defaulting to the streaming HTTP one."""

    return factory if factory is not None else open_sse_chunk_stream