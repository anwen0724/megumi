"""Bridges between synchronous callers and asynchronous work.

A callback that returns "a value or a promise" is one of the recurring shapes in the
provider contract: a function must run its callback eagerly, so the callback observes the
resources created for it before the call returns, and yet hand the result back as
something the caller can await. A Python coroutine cannot do that on its own, because
calling a coroutine function executes no part of its body. :class:`AwaitableResult`
supplies the missing half: it starts a coroutine while the caller is still inside the
starting call, runs its synchronous prefix there, and stays awaitable so the caller can
collect the result later.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Coroutine, Generator
from typing import Any

__all__ = ["AwaitableResult"]


class AwaitableResult[T](Awaitable[T]):
    """An awaitable for a coroutine whose synchronous prefix has already run.

    Construction advances the coroutine up to its first suspension point. A coroutine that
    finishes during that prefix settles immediately, which is how a failure raised before
    the first ``await`` reaches the caller instead of being lost.

    The coroutine is resumed by this object alone. While it waits on a future, the caller
    is registered as a completion callback; while it waits on anything else, the awaited
    object is handed to the caller, whose own ``await`` drives it. Either way a single
    resume path exists, so the coroutine is never advanced twice.
    """

    def __init__(self, coroutine: Coroutine[Any, Any, T]) -> None:
        self._coroutine = coroutine
        self._result: T | None = None
        self._error: BaseException | None = None
        self._finished = False
        self._suspended: Awaitable[Any] | None = None
        self._drive(None)

    def __await__(self) -> Generator[Any, Any, T]:
        """Complete with the coroutine's result, or re-raise its failure."""

        while not self._finished:
            suspended = self._suspended
            if suspended is None:
                raise RuntimeError("AwaitableResult was not given a coroutine that suspends")
            if isinstance(suspended, asyncio.Future):
                # A future does not resume the coroutine by itself, so this object is
                # registered as its completion callback. The caller waits on the future
                # too, but must not act on its outcome: the callback already did, and
                # resuming a coroutine twice is an error. It may also have settled the
                # coroutine already, which is why the loop re-checks before yielding.
                yield suspended
            elif isinstance(suspended, AwaitableResult):
                self._drive((yield from suspended.__await__()))
            else:
                self._drive((yield suspended))
        return self._conclude()

    def _drive(self, sent: Any, *, failing: bool = False) -> None:
        """Advance the coroutine once, recording how it settled."""

        try:
            suspended = (
                self._coroutine.throw(sent) if failing else self._coroutine.send(sent)
            )
        except StopIteration as stopped:
            self._result = stopped.value
            self._error = None
            self._finished = True
            return
        except BaseException as error:
            self._error = error
            self._finished = True
            return

        self._suspended = suspended
        if isinstance(suspended, asyncio.Future):
            suspended.add_done_callback(self._resume)

    def _resume(self, settled: asyncio.Future[Any]) -> None:
        """Resume the coroutine with the outcome of the future it was waiting on."""

        if self._finished:
            return
        if settled.cancelled():
            self._drive(asyncio.CancelledError(), failing=True)
            return
        error = settled.exception()
        if error is not None:
            self._drive(error, failing=True)
            return
        self._drive(settled.result())

    def _conclude(self) -> T:
        """Return the recorded result, or re-raise the recorded failure."""

        if self._error is not None:
            raise self._error
        # ``None`` is a legitimate result, so the narrowing here is about the empty
        # initialiser rather than about the coroutine's contract.
        return self._result  # type: ignore[return-value]
