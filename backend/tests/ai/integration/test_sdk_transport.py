"""Synthetic HTTP streams verify real SDK cancellation and response ownership."""

import asyncio

import httpx2
import pytest

from app.ai.auth.types import ResolvedAuth
from app.ai.options import CallOptions
from app.ai.runtime.clients import ClientRuntime
from app.ai.stream import AssistantResponse


async def create_response_stream(client, payload, request_options):
    """Exercise the real SDK endpoint with a minimal test-only protocol request."""
    return await client.responses.create(
        model="sample", input="hello", stream=True, extra_body=payload, **request_options
    )


class WaitingBody(httpx2.AsyncByteStream):
    def __init__(self):
        self.reading = asyncio.Event()
        self.exited = asyncio.Event()
        self.closed = False

    async def __aiter__(self):
        try:
            self.reading.set()
            await asyncio.Event().wait()
            yield b"unused"
        finally:
            self.exited.set()

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [200, 429])
async def test_cancel_sdk_body_read_closes_response_before_final(provider, status):
    body = WaitingBody()
    requests = []

    def handle(request):
        requests.append(request)
        return httpx2.Response(status, stream=body)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle)) as http:
        runtime = ClientRuntime()

        async def produce(writer):
            stream = await runtime.open_stream(
                create_response_stream,
                {"stream": True},
                model=provider.get_models()[0],
                auth=ResolvedAuth(
                    key="fake",
                    source="explicit",
                    base_url=provider.base_url,
                    headers={"authorization": "Bearer fake"},
                ),
                options=CallOptions(http_client=http, max_retries=2),
                writer=writer,
            )
            async for _ in stream:
                pass

        response = AssistantResponse(provider.get_models()[0], produce)
        await asyncio.wait_for(body.reading.wait(), 1)
        response.cancel()
        final = await asyncio.wait_for(response.result(), 1)
        assert final.stop_reason == "aborted"
        assert body.exited.is_set()
        assert body.closed
        assert len(requests) == 1
        assert not http.is_closed
        await runtime.aclose()


@pytest.mark.asyncio
async def test_generation_and_close_errors_both_redact_credentials(provider):
    def handle(request):
        return httpx2.Response(400, json={"error": {"message": "bad fake-secret"}})

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle)) as http:
        runtime = ClientRuntime()

        async def produce(writer):
            async def fail_close():
                raise RuntimeError("close fake-secret")

            writer.add_cleanup(fail_close)
            await runtime.open_stream(
                create_response_stream,
                {"stream": True, "image": "private-image", "arguments": "private-args"},
                model=provider.get_models()[0],
                auth=ResolvedAuth(
                    key="fake-secret",
                    source="explicit",
                    base_url=provider.base_url,
                    headers={"authorization": "Bearer fake-secret"},
                ),
                options=CallOptions(http_client=http),
                writer=writer,
            )

        response = AssistantResponse(provider.get_models()[0], produce)
        final = await response.result()
        assert final.stop_reason == "error"
        assert "400" in final.error_message and "bad" in final.error_message
        assert "fake-secret" not in str(final)
        assert "private-image" not in str(final) and "private-args" not in str(final)
        assert final.diagnostics is None
        with pytest.raises(ExceptionGroup) as caught:
            await response.aclose()
        assert "close [redacted]" in str(caught.value.exceptions[0])
        assert "fake-secret" not in str(caught.value.exceptions[0])
        assert final.diagnostics is None
        await runtime.aclose()


@pytest.mark.asyncio
async def test_body_connection_failure_is_not_retried(provider):
    requests = []

    class BrokenBody(httpx2.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            yield b'data: {"part": 1}\n\n'
            raise httpx2.ReadError("connection lost")

        async def aclose(self):
            self.closed = True

    body = BrokenBody()

    def handle(request):
        requests.append(request)
        return httpx2.Response(200, stream=body)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle)) as http:
        runtime = ClientRuntime()

        async def produce(writer):
            stream = await runtime.open_stream(
                create_response_stream,
                {},
                model=provider.get_models()[0],
                auth=ResolvedAuth(
                    key="fake",
                    source="explicit",
                    base_url=provider.base_url,
                    headers={"authorization": "Bearer fake"},
                ),
                options=CallOptions(http_client=http, max_retries=3),
                writer=writer,
            )
            async for _ in stream:
                pass

        final = await AssistantResponse(provider.get_models()[0], produce).result()
        assert final.stop_reason == "error"
        assert "Connection error" in final.error_message
        assert len(requests) == 1 and body.closed
        await runtime.aclose()
