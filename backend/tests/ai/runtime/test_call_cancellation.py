"""Cancellation distinguishes shared-generation ownership from transient waiters."""

import asyncio

import pytest

from app.ai.messages import TextContent
from app.ai.stream import AssistantResponse


@pytest.mark.asyncio
async def test_cancelled_result_and_event_waiters_do_not_stop_shared_generation(provider):
    entered = asyncio.Event()
    release = asyncio.Event()
    closed = []

    async def cleanup():
        closed.append(1)

    async def produce(writer):
        writer.add_cleanup(cleanup)
        entered.set()
        await release.wait()
        writer.emit({"type": "start", "partial": writer.partial})
        writer.partial.stop_reason = "stop"
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    response = AssistantResponse(provider.get_models()[0], produce)
    await entered.wait()
    waiter = asyncio.create_task(response.result())
    iterator = aiter(response)
    next_event = asyncio.create_task(anext(iterator))
    await asyncio.sleep(0)
    waiter.cancel()
    next_event.cancel()
    for task in (waiter, next_event):
        with pytest.raises(asyncio.CancelledError):
            await task
    assert not closed
    release.set()
    assert (await asyncio.wait_for(response.result(), 1)).stop_reason == "stop"
    assert [event["type"] async for event in response] == ["start", "done"]
    assert closed == [1]


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["cancel", "close", "signal", "pre_cancel", "pre_signal"])
async def test_explicit_cancellation_stops_work_and_cleans_exactly_once(provider, method):
    entered = asyncio.Event()
    exited = asyncio.Event()
    signal = asyncio.Event()
    closed = []

    async def cleanup():
        closed.append(1)

    async def produce(writer):
        writer.add_cleanup(cleanup)
        writer.partial.content.append(TextContent(text="partial"))
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            exited.set()

    if method == "pre_signal":
        signal.set()
    response = AssistantResponse(provider.get_models()[0], produce, signal=signal)
    if method == "pre_cancel":
        response.cancel()
    if not method.startswith("pre"):
        await asyncio.wait_for(entered.wait(), 1)
        if method == "signal":
            signal.set()
        elif method == "cancel":
            response.cancel()
        else:
            await response.aclose()
    final = await asyncio.wait_for(response.result(), 1)
    assert final.stop_reason == "aborted"
    if method.startswith("pre"):
        assert not entered.is_set() and not closed
    else:
        assert final.content[0].text == "partial" and exited.is_set() and closed == [1]
    await asyncio.gather(response.aclose(), response.aclose())
    assert len(closed) == (0 if method.startswith("pre") else 1)


@pytest.mark.asyncio
async def test_cancelled_close_waiter_does_not_abandon_cleanup(provider):
    reading = asyncio.Event()
    cleaning = asyncio.Event()
    release = asyncio.Event()
    closed = []

    async def cleanup():
        cleaning.set()
        await release.wait()
        closed.append(1)

    async def produce(writer):
        writer.add_cleanup(cleanup)
        reading.set()
        await asyncio.Event().wait()

    response = AssistantResponse(provider.get_models()[0], produce)
    await reading.wait()
    closer = asyncio.create_task(response.aclose())
    await cleaning.wait()
    closer.cancel()
    with pytest.raises(asyncio.CancelledError):
        await closer
    assert not closed
    release.set()
    assert (await asyncio.wait_for(response.result(), 1)).stop_reason == "aborted"
    await response.aclose()
    assert closed == [1]
