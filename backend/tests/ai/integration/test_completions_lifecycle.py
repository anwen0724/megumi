"""Integrate actual Completions SDK calls with retries, cancellation and ownership."""

import asyncio

import httpx2
import pytest

from app.ai import CompletionsOptions, Context, TextContent, ThinkingContent


@pytest.mark.asyncio
async def test_establishment_retry_runs_hooks_once(provider, sdk_harness, native_sse):
    observed = []
    attempts = 0

    async def handler(request):
        nonlocal attempts
        attempts += 1
        observed.append("request")
        if attempts == 1:
            return httpx2.Response(
                429, headers={"retry-after-ms": "1"}, json={"error": {"message": "busy"}}
            )
        return httpx2.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=native_sse(
                {"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]}
            ),
        )

    async with sdk_harness(handler=handler) as (models, http, requests):
        response = models.stream(
            provider.get_models()[0],
            Context(messages=[]),
            CompletionsOptions(
                api_key="key",
                http_client=http,
                max_retries=1,
                on_payload=lambda *_: observed.append("payload"),
                on_response=lambda *_: observed.append("response"),
            ),
        )
        events = [e async for e in response]
        assert (await response.result()).stop_reason == "stop"
        assert observed == ["payload", "request", "request", "response"]
        assert requests[0].content == requests[1].content
        assert [e["type"] for e in events].count("start") == 1
        assert not http.is_closed


@pytest.mark.asyncio
async def test_body_disconnect_preserves_output_and_never_retries(provider, sdk_harness):
    closed = asyncio.Event()

    class Body(httpx2.AsyncByteStream):
        async def __aiter__(self):
            yield (
                b'data: {"choices":[{"delta":{"content":"partial",'
                b'"reasoning_details":[{"type":"reasoning.encrypted","data":"opaque"}]}}]}\n\n'
            )
            raise httpx2.ReadError("disconnected")

        async def aclose(self):
            closed.set()

    async def handler(request):
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, stream=Body())

    async with sdk_harness(handler=handler) as (models, http, requests):
        final = await models.complete(
            provider.get_models()[0],
            Context(messages=[]),
            CompletionsOptions(api_key="key", http_client=http, max_retries=2),
        )
        assert final.stop_reason == "error"
        assert final.content[0] == TextContent(text="partial")
        assert isinstance(final.content[1], ThinkingContent)
        assert "opaque" in final.content[1].thinking_signature
        assert len(requests) == 1
        assert closed.is_set()


@pytest.mark.asyncio
@pytest.mark.parametrize("hook", ["payload", "response"])
async def test_hook_failure_is_final_without_retry(provider, sdk_harness, hook):
    def fail(*_):
        raise RuntimeError("hook failed")

    async with sdk_harness() as (models, http, requests):
        response = models.stream(
            provider.get_models()[0],
            Context(messages=[]),
            CompletionsOptions(
                api_key="key",
                http_client=http,
                max_retries=2,
                on_payload=fail if hook == "payload" else None,
                on_response=fail if hook == "response" else None,
            ),
        )
        final = await response.result()
        assert final.stop_reason == "error"
        assert final.error_message == "hook failed"
        assert len(requests) == (0 if hook == "payload" else 1)
        assert [e["type"] async for e in response] == ["error"]


@pytest.mark.asyncio
@pytest.mark.parametrize("owner", ["response", "signal", "complete", "models"])
async def test_cancel_owns_body_read_and_closes_resources(provider, sdk_harness, owner):
    entered, closed = asyncio.Event(), asyncio.Event()

    class Body(httpx2.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
            entered.set()
            await asyncio.Event().wait()

        async def aclose(self):
            closed.set()

    async def handler(request):
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, stream=Body())

    async with sdk_harness(handler=handler) as (models, http, requests):
        signal = asyncio.Event()
        options = CompletionsOptions(api_key="key", http_client=http, signal=signal)
        response = (
            None
            if owner == "complete"
            else models.stream(provider.get_models()[0], Context(messages=[]), options)
        )
        task = (
            asyncio.create_task(
                models.complete(provider.get_models()[0], Context(messages=[]), options)
            )
            if owner == "complete"
            else None
        )
        await asyncio.wait_for(entered.wait(), 1)
        if owner == "complete":
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            if owner == "response":
                response.cancel()
            elif owner == "signal":
                signal.set()
            else:
                await models.aclose()
            final = await asyncio.wait_for(response.result(), 1)
            assert final.stop_reason == "aborted"
            assert final.content == [TextContent(text="partial")]
            await response.aclose()
        assert closed.is_set()
        assert len(requests) == 1
        assert not http.is_closed


@pytest.mark.asyncio
async def test_cancel_result_waiter_leaves_generation_running(provider, sdk_harness, native_sse):
    entered, release = asyncio.Event(), asyncio.Event()

    async def handler(request):
        entered.set()
        await release.wait()
        return httpx2.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=native_sse(
                {"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]}
            ),
        )

    async with sdk_harness(handler=handler) as (models, http, _):
        response = models.stream(
            provider.get_models()[0],
            Context(messages=[]),
            CompletionsOptions(api_key="key", http_client=http),
        )
        waiter = asyncio.create_task(response.result())
        await asyncio.wait_for(entered.wait(), 1)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        release.set()
        assert (await asyncio.wait_for(response.result(), 1)).stop_reason == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["establish", "backoff"])
async def test_cancel_establishment_or_retry_wait(provider, sdk_harness, monkeypatch, stage):
    entered, cancelled = asyncio.Event(), asyncio.Event()

    async def blocked_wait(*_):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    if stage == "backoff":
        monkeypatch.setattr("app.ai.runtime.retry._sleep", blocked_wait)

    async def handler(request):
        if stage == "establish":
            await blocked_wait()
        return httpx2.Response(429, json={"error": {"message": "retry"}})

    async with sdk_harness(handler=handler) as (models, http, requests):
        response = models.stream(
            provider.get_models()[0],
            Context(messages=[]),
            CompletionsOptions(api_key="key", http_client=http, max_retries=2),
        )
        await asyncio.wait_for(entered.wait(), 1)
        response.cancel()
        final = await asyncio.wait_for(response.result(), 1)
        assert final.stop_reason == "aborted"
        await response.aclose()
        assert cancelled.is_set()
        assert len(requests) == 1


@pytest.mark.asyncio
async def test_result_precedes_remaining_cleanup_and_close_reports_failure(
    provider, sdk_harness, native_sse
):
    sdk_closed, remaining_close, release = asyncio.Event(), asyncio.Event(), asyncio.Event()

    class Response(httpx2.Response):
        closes = 0

        async def aclose(self):
            self.closes += 1
            if self.closes == 1:
                await super().aclose()
                sdk_closed.set()
            else:
                remaining_close.set()
                await release.wait()
                raise RuntimeError("remaining cleanup failure")

    async def handler(request):
        return Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=BytesBody(
                native_sse({"choices": [{"delta": {"content": "answer"}, "finish_reason": "stop"}]})
            ),
        )

    # The external response provides a separate controllable remaining close, after
    # the SDK's own iteration cleanup. No application collaborator is replaced.
    with pytest.raises(ExceptionGroup, match="Models cleanup failed"):
        async with sdk_harness(handler=handler) as (models, http, _):
            response = models.stream(
                provider.get_models()[0],
                Context(messages=[]),
                CompletionsOptions(api_key="key", http_client=http),
            )
            final = await asyncio.wait_for(response.result(), 1)
            assert sdk_closed.is_set()
            await asyncio.wait_for(remaining_close.wait(), 1)
            assert final.stop_reason == "stop"
            closing = asyncio.create_task(response.aclose())
            await asyncio.sleep(0)
            assert not closing.done()
            release.set()
            with pytest.raises(ExceptionGroup, match="cleanup"):
                await closing
            assert (await response.result()) is final
            assert final.error_message is None
            assert final.diagnostics is None
            assert not http.is_closed


class BytesBody(httpx2.AsyncByteStream):
    """A minimal external body whose close timing remains owned by the SDK."""

    def __init__(self, data):
        self.data = data

    async def __aiter__(self):
        yield self.data


@pytest.mark.asyncio
async def test_native_error_event_keeps_partial_and_redacts_credentials(provider, sdk_harness):
    data = (
        b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
        b'data: {"error":{"message":"vendor rejected test-secret","code":"bad"}}\n\n'
    )
    async with sdk_harness(data=data) as (models, http, requests):
        final = await models.complete(
            provider.get_models()[0],
            Context(messages=[]),
            CompletionsOptions(api_key="test-secret", http_client=http, max_retries=3),
        )
        assert final.stop_reason == "error"
        assert final.content == [TextContent(text="partial")]
        assert "test-secret" not in final.error_message
        assert len(requests) == 1
