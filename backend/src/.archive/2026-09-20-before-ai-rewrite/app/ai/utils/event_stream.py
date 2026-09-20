"""A single-consumer event stream whose last event also settles the whole operation.

The container exists because the provider contract is "return a stream, then report
failures inside it": a request that fails after it has started cannot throw at the call
site, so the failure has to travel as an event. Awaiting the stream yields the terminal
message, while iterating it yields every event as it arrives, which keeps one producer
feeding both a live consumer and a caller who only wants the answer.

Ordering is what makes that safe. Events are delivered to a waiting consumer before they
are queued, so a consumer that is already reading observes every event in production
order and never sees one after the terminal event.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable

from app.ai.types import (
    AssistantMessage,
    AssistantMessageEvent,
    EventDone,
    EventError,
)

__all__ = [
    "AssistantMessageEventStream",
    "EventStream",
    "createAssistantMessageEventStream",
]


class _FifoQueue[T]:
    """A first-in first-out queue that tolerates values of any type, including ``None``.

    Two stacks are used so that draining the incoming one costs nothing per element; the
    length is the combined depth of both.
    """

    def __init__(self) -> None:
        self._incoming: list[T] = []
        self._outgoing: list[T] = []

    def __len__(self) -> int:
        return len(self._incoming) + len(self._outgoing)

    def enqueue(self, value: T) -> None:
        """Add ``value`` to the back of the queue."""

        self._incoming.append(value)

    def dequeue(self) -> T:
        """Remove and return the front value; the caller must have checked the length."""

        if not self._outgoing:
            while self._incoming:
                self._outgoing.append(self._incoming.pop())
        return self._outgoing.pop()


class EventStream[T, R]:
    """Delivers events to one consumer and settles once the terminal event arrives.

    ``isComplete`` marks the event that ends the stream, and ``extractResult`` turns that
    event into the result the caller awaits.
    """

    def __init__(
        self,
        isComplete: Callable[[T], bool],
        extractResult: Callable[[T], R],
    ) -> None:
        self._queue: _FifoQueue[T] = _FifoQueue()
        self._waiting: _FifoQueue[asyncio.Future[T]] = _FifoQueue()
        self._done = False
        self._isComplete = isComplete
        self._extractResult = extractResult
        self._finalResult: asyncio.Future[R] = asyncio.get_running_loop().create_future()

    def push(self, event: T) -> None:
        """Deliver an event to the waiting consumer, or hold it until one arrives.

        Events pushed after the stream ended are dropped, so a producer that keeps
        emitting after a terminal event cannot break ordering.
        """

        if self._done:
            return

        if self._isComplete(event):
            self._done = True
            if not self._finalResult.done():
                self._finalResult.set_result(self._extractResult(event))

        if len(self._waiting) > 0:
            waiter = self._waiting.dequeue()
            if not waiter.done():
                waiter.set_result(event)
        else:
            self._queue.enqueue(event)

    def end(self, result: R | None = None) -> None:
        """End the stream without a terminal event, releasing every waiting consumer.

        A result settles the awaited result; without one the stream ends silently, which
        is how a producer reports that no terminal event will ever arrive.
        """

        self._done = True
        if result is not None and not self._finalResult.done():
            self._finalResult.set_result(result)
        while len(self._waiting) > 0:
            waiter = self._waiting.dequeue()
            if not waiter.done():
                waiter.set_exception(_StreamEnded())

    def __aiter__(self) -> AsyncIterator[T]:
        """Iterate the events as they arrive, stopping after the terminal event."""

        return self._iterate()

    async def _iterate(self) -> AsyncIterator[T]:
        while True:
            if len(self._queue) > 0:
                yield self._queue.dequeue()
            elif self._done:
                return
            else:
                waiter: asyncio.Future[T] = asyncio.get_running_loop().create_future()
                self._waiting.enqueue(waiter)
                try:
                    yield await waiter
                except _StreamEnded:
                    return

    def result(self) -> Awaitable[R]:
        """The result the terminal event carries, available once that event arrives."""

        return self._finalResult


class _StreamEnded(Exception):
    """Internal signal that a waiting consumer's stream ended without an event."""


class AssistantMessageEventStream(EventStream[AssistantMessageEvent, AssistantMessage]):
    """The stream a provider returns: events while generating, the message at the end.

    The stream is complete once a ``done`` or ``error`` event arrives, and that same event
    carries the assistant message the caller awaits.
    """

    def __init__(self) -> None:
        super().__init__(_is_terminal, _extract_terminal_message)


def _is_terminal(event: AssistantMessageEvent) -> bool:
    """Whether ``event`` ends the stream."""

    return event.type == "done" or event.type == "error"


def _extract_terminal_message(event: AssistantMessageEvent) -> AssistantMessage:
    """The assistant message carried by a terminal event."""

    if isinstance(event, EventDone):
        return event.message
    if isinstance(event, EventError):
        return event.error
    raise ValueError(f"Unexpected event type for final result: {event.type}")


def createAssistantMessageEventStream() -> AssistantMessageEventStream:
    """Create a stream for a caller that wants the container without the provider."""

    return AssistantMessageEventStream()

