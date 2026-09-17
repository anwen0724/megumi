"""Tests for the event stream container.

The cases pin the ordering guarantees the provider contract relies on: every event is
delivered to a live consumer in production order, a terminal event both ends the
iteration and settles the awaited result, and nothing is delivered after it.
"""

from __future__ import annotations

import asyncio

import pytest

from app.ai.types import (
    AssistantMessage,
    EventDone,
    EventError,
    EventStart,
    EventTextDelta,
    StopReason,
    Usage,
    UsageCost,
)
from app.ai.utils.event_stream import (
    AssistantMessageEventStream,
    EventStream,
    createAssistantMessageEventStream,
)


def _message(stop_reason: StopReason = StopReason.STOP) -> AssistantMessage:
    return AssistantMessage(
        content=[],
        api="openai-completions",
        provider="openai",
        model="m",
        usage=Usage(
            input=0,
            output=0,
            cacheRead=0,
            cacheWrite=0,
            totalTokens=0,
            cost=UsageCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0, total=0.0),
        ),
        stopReason=stop_reason,
        timestamp=0,
    )


@pytest.mark.asyncio
async def test_result_settles_when_the_terminal_event_arrives() -> None:
    stream: EventStream[str, int] = EventStream(lambda event: event == "end", len)
    assert not stream.result().done()

    stream.push("a")
    stream.push("end")

    assert await stream.result() == 3


@pytest.mark.asyncio
async def test_iteration_yields_queued_events_then_stops() -> None:
    stream: EventStream[str, int] = EventStream(lambda event: event == "end", len)
    stream.push("a")
    stream.push("b")
    stream.push("end")
    stream.push("after")

    seen = [event async for event in stream]

    assert seen == ["a", "b", "end"]


@pytest.mark.asyncio
async def test_events_pushed_later_reach_a_live_consumer_in_order() -> None:
    stream: EventStream[str, int] = EventStream(lambda event: event == "end", len)
    seen: list[str] = []

    async def consume() -> None:
        async for event in stream:
            seen.append(event)

    consumer = asyncio.ensure_future(consume())
    await asyncio.sleep(0)

    stream.push("a")
    await asyncio.sleep(0)
    stream.push("b")
    await asyncio.sleep(0)
    stream.push("end")
    await consumer

    assert seen == ["a", "b", "end"]


@pytest.mark.asyncio
async def test_events_pushed_after_the_terminal_event_are_dropped() -> None:
    stream: EventStream[str, int] = EventStream(lambda event: event == "end", len)
    stream.push("end")
    stream.push("late")

    assert [event async for event in stream] == ["end"]


@pytest.mark.asyncio
async def test_end_releases_a_waiting_consumer_without_a_result() -> None:
    stream: EventStream[str, int] = EventStream(lambda event: event == "end", len)
    seen: list[str] = []

    async def consume() -> None:
        async for event in stream:
            seen.append(event)

    consumer = asyncio.ensure_future(consume())
    await asyncio.sleep(0)
    stream.push("a")
    await asyncio.sleep(0)
    stream.end()
    await consumer

    assert seen == ["a"]
    assert not stream.result().done()


@pytest.mark.asyncio
async def test_end_settles_an_explicit_result() -> None:
    stream: EventStream[str, int] = EventStream(lambda event: event == "end", len)

    stream.end(7)

    assert await stream.result() == 7


@pytest.mark.asyncio
async def test_twice_ending_keeps_the_first_result() -> None:
    stream: EventStream[str, int] = EventStream(lambda event: event == "end", len)

    stream.end(1)
    stream.end(2)

    assert await stream.result() == 1


@pytest.mark.asyncio
async def test_assistant_stream_settles_on_the_done_message() -> None:
    stream = AssistantMessageEventStream()
    message = _message()

    stream.push(EventStart(partial=message))
    stream.push(EventDone(reason="stop", message=message))

    assert await stream.result() is message


@pytest.mark.asyncio
async def test_assistant_stream_settles_on_the_error_message() -> None:
    stream = AssistantMessageEventStream()
    message = _message(StopReason.ERROR)

    stream.push(EventError(reason="error", error=message))

    assert await stream.result() is message


@pytest.mark.asyncio
async def test_assistant_stream_iterates_partial_updates_before_the_terminal_event() -> None:
    stream = createAssistantMessageEventStream()
    message = _message()
    stream.push(EventStart(partial=message))
    stream.push(EventTextDelta(contentIndex=0, delta="hi", partial=message))
    stream.push(EventDone(reason="stop", message=message))

    seen = [event.type async for event in stream]

    assert seen == ["start", "text_delta", "done"]
