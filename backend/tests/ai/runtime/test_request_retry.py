"""Request retry wraps establishment only and keeps cancellation observable."""

import asyncio

import pytest

from app.ai.runtime import retry
from app.ai.runtime.retry import retry_provider_request


@pytest.mark.asyncio
async def test_default_does_not_retry_failure():
    attempts = []

    async def request():
        attempts.append(1)
        raise ConnectionError("offline")

    with pytest.raises(ConnectionError):
        await retry_provider_request(request)
    assert attempts == [1]


class HttpFailure(Exception):
    def __init__(self, status, headers=None):
        super().__init__("provider failure")
        self.status = status
        self.headers = headers or {}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "headers", "expected"),
    [
        (408, {}, 2),
        (409, {}, 2),
        (429, {}, 2),
        (500, {}, 2),
        (503, {}, 2),
        (400, {}, 1),
        (401, {}, 1),
        (400, {"x-should-retry": "true"}, 2),
        (503, {"x-should-retry": "false"}, 1),
    ],
)
async def test_http_status_and_bidirectional_override(status, headers, expected, monkeypatch):
    waits = []

    async def sleep(seconds):
        waits.append(seconds)

    monkeypatch.setattr(retry, "_sleep", sleep)
    attempts = []

    async def request():
        attempts.append(1)
        raise HttpFailure(status, headers)

    with pytest.raises(HttpFailure):
        await retry_provider_request(request, max_retries=1)
    assert len(attempts) == expected
    assert len(waits) == expected - 1


@pytest.mark.asyncio
async def test_connection_retries_but_programming_error_does_not(monkeypatch):
    async def sleep(seconds):
        pass

    monkeypatch.setattr(retry, "_sleep", sleep)
    attempts = []

    async def request():
        attempts.append(1)
        if len(attempts) < 3:
            raise ConnectionError("offline")
        return "response"

    assert await retry_provider_request(request, max_retries=2) == "response"
    assert len(attempts) == 3
    attempts.clear()

    async def bad():
        attempts.append(1)
        raise ValueError("bad program")

    with pytest.raises(ValueError):
        await retry_provider_request(bad, max_retries=2)
    assert len(attempts) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({"retry-after-ms": "1250", "retry-after": "9"}, 1.25),
        ({"retry-after": "2"}, 2),
        ({"retry-after": "Thu, 01 Jan 1970 00:00:03 GMT"}, 2),
        ({"retry-after": "garbage"}, 0),
        ({"retry-after-ms": "-1"}, 0),
        ({"retry-after": "Thu, 01 Jan 1970 00:00:00 GMT"}, 0),
        ({}, 0.375),
    ],
)
async def test_server_wait_precedence_and_jitter(headers, expected, monkeypatch):
    waits = []

    async def sleep(seconds):
        waits.append(seconds)

    monkeypatch.setattr(retry, "_sleep", sleep)
    monkeypatch.setattr(retry, "_now", lambda: 1)
    monkeypatch.setattr(retry, "_random", lambda: 1)
    count = 0

    async def request():
        nonlocal count
        count += 1
        if count == 1:
            raise HttpFailure(429, headers)
        return "ok"

    assert await retry_provider_request(request, max_retries=1) == "ok"
    assert waits == [expected]


@pytest.mark.asyncio
async def test_server_delay_cap_and_zero_disable(monkeypatch):
    waits = []

    async def sleep(seconds):
        waits.append(seconds)

    monkeypatch.setattr(retry, "_sleep", sleep)

    async def request():
        raise HttpFailure(429, {"retry-after": "61"})

    with pytest.raises(ValueError, match="retry delay"):
        await retry_provider_request(request, max_retries=1)
    assert not waits
    with pytest.raises(HttpFailure):
        await retry_provider_request(request, max_retries=1, max_retry_delay_ms=0)
    assert waits == [61]


@pytest.mark.asyncio
async def test_abort_backoff_and_preaborted_never_make_another_attempt(monkeypatch):
    entered = asyncio.Event()
    cancelled = asyncio.Event()
    signal = asyncio.Event()
    attempts = []

    async def sleep(seconds):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(retry, "_sleep", sleep)

    async def request():
        attempts.append(1)
        raise ConnectionError("offline")

    task = asyncio.create_task(retry_provider_request(request, max_retries=3, signal=signal))
    await asyncio.wait_for(entered.wait(), 1)
    signal.set()
    with pytest.raises(retry.SignalAborted):
        await asyncio.wait_for(task, 1)
    assert cancelled.is_set() and attempts == [1]
    with pytest.raises(retry.SignalAborted):
        await retry_provider_request(request, max_retries=3, signal=signal)
    assert attempts == [1]


@pytest.mark.asyncio
async def test_exponential_cap_and_body_failure_are_not_retried(monkeypatch):
    waits = []

    async def sleep(seconds):
        waits.append(seconds)

    monkeypatch.setattr(retry, "_sleep", sleep)
    monkeypatch.setattr(retry, "_random", lambda: 0)
    calls = []

    async def request():
        calls.append(1)
        raise ConnectionError("offline")

    with pytest.raises(ConnectionError):
        await retry_provider_request(request, max_retries=6)
    assert waits == [0.5, 1, 2, 4, 8, 8]
    assert len(calls) == 7
    calls.clear()

    async def body():
        yield "first"
        raise ConnectionError("body disconnected")

    async def opened():
        calls.append(1)
        return body()

    response = await retry_provider_request(opened, max_retries=3)
    assert await anext(response) == "first"
    with pytest.raises(ConnectionError):
        await anext(response)
    assert calls == [1]


@pytest.mark.asyncio
async def test_cancelling_request_task_drains_signal_watcher():
    entered = asyncio.Event()
    exited = asyncio.Event()

    async def request():
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            exited.set()

    task = asyncio.create_task(retry_provider_request(request, signal=asyncio.Event()))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert exited.is_set()
