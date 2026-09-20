"""Cancellation primitives shared by provider requests.

``AbortSignal`` is a cancellation token that a caller hands to a request and that
anyone may observe: it reports whether the request was cancelled, and it notifies
subscribers when that happens. It is a value rather than a handle on a running task, so
it can be forwarded through every layer that needs it, combined with other signals, and
carry the reason for the cancellation.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from typing import Any

AbortListener = Callable[[], None]

# Keeps references to tasks that only exist to consume an abandoned awaitable.
_OBSERVERS: set[asyncio.Future[None]] = set()


class AbortError(Exception):
    """Raised when an operation stops because its signal was aborted."""

    def __init__(self, message: str = "The operation was aborted") -> None:
        super().__init__(message)
        self.name = "AbortError"


class AbortSignal:
    """Observes whether one logical operation was cancelled."""

    def __init__(self) -> None:
        self._aborted = False
        self._reason: Any | None = None
        # Each entry keeps the listener together with the once flag supplied when it was
        # added, so removal can match on the original callable.
        self._listeners: list[tuple[AbortListener, bool]] = []

    @property
    def aborted(self) -> bool:
        """Whether this signal has been aborted."""

        return self._aborted

    @property
    def reason(self) -> Any | None:
        """The value passed to ``AbortController.abort``, if any."""

        return self._reason

    def add_listener(self, listener: AbortListener, *, once: bool = False) -> None:
        """Subscribe to cancellation.

        Subscribing to an already-aborted signal invokes the listener immediately, so a
        subscriber can never miss a cancellation that happened before it subscribed.
        """

        if self._aborted:
            listener()
            return
        self._listeners.append((listener, once))

    def remove_listener(self, listener: AbortListener) -> None:
        """Unsubscribe a listener previously passed to ``add_listener``."""

        self._listeners = [entry for entry in self._listeners if entry[0] is not listener]

    def _abort(self, reason: Any | None) -> None:
        """Mark the signal aborted and notify every listener in subscription order.

        Only the first abort has an effect: a later call leaves the original reason in
        place.
        """

        if self._aborted:
            return
        self._aborted = True
        self._reason = reason
        listeners = list(self._listeners)
        self._listeners = []
        for listener, _once in listeners:
            listener()


class AbortController:
    """Owns an :class:`AbortSignal`; it is the only side allowed to cancel it."""

    def __init__(self) -> None:
        self.signal = AbortSignal()

    def abort(self, reason: Any | None = None) -> None:
        """Cancel the operation holding this controller's signal."""

        self.signal._abort(reason)


def abort_reason(signal: AbortSignal) -> Any:
    """The value an aborted operation should raise: the signal's reason, or an AbortError."""

    if signal.reason is not None:
        return signal.reason
    return AbortError()


def operation_signal(signal: AbortSignal | None) -> AbortSignal:
    """Return the caller's signal, or a fresh one for public APIs whose signal is optional."""

    return signal if signal is not None else AbortController().signal


async def race_with_abort_signal[T](operation: Awaitable[T], signal: AbortSignal) -> T:
    """Await ``operation`` but stop waiting when ``signal`` aborts.

    The abandoned operation keeps running and stays observed, so a failure that arrives
    after the abort is never left unhandled.
    """

    if signal.aborted:
        _observe(operation)
        raise _as_exception(abort_reason(signal))

    loop = asyncio.get_running_loop()
    aborted: asyncio.Future[None] = loop.create_future()
    unsubscribe = _subscribe_abort(signal, aborted)
    operation_task = asyncio.ensure_future(operation)

    # The two futures carry unrelated result types, so the wait set is typed as the
    # common future shape rather than as either of them.
    waiting: set[asyncio.Future[Any]] = {operation_task, aborted}
    try:
        done, _pending = await asyncio.wait(waiting, return_when=asyncio.FIRST_COMPLETED)
    except BaseException:
        unsubscribe()
        raise

    unsubscribe()
    if operation_task in done:
        return operation_task.result()

    # The abort won the race. Keep observing the operation so its eventual failure is
    # handled instead of surfacing as an unretrieved task exception.
    _observe(operation_task)
    raise _as_exception(abort_reason(signal))


def _subscribe_abort(signal: AbortSignal, future: asyncio.Future[None]) -> Callable[[], None]:
    """Resolve ``future`` when ``signal`` aborts, and return the unsubscribe callable."""

    def on_abort() -> None:
        if not future.done():
            future.set_result(None)

    signal.add_listener(on_abort, once=True)
    return lambda: signal.remove_listener(on_abort)


def _observe[T](operation: Awaitable[T]) -> None:
    """Consume an abandoned awaitable's outcome so it cannot raise unobserved."""

    async def swallow() -> None:
        with contextlib.suppress(BaseException):
            await operation

    # Kept referenced until it finishes so that an unfinished abandoned task is never
    # collected before it has consumed the operation's outcome.
    observer = asyncio.ensure_future(swallow())
    _OBSERVERS.add(observer)
    observer.add_done_callback(_OBSERVERS.discard)


def _as_exception(reason: Any) -> BaseException:
    """Coerce an abort reason into something raisable."""

    if isinstance(reason, BaseException):
        return reason
    return AbortError(str(reason))
