"""A sleep that can be abandoned by a cancellation signal.

Waiting is the one place a long-running request is not observed by the caller, so the wait
has to end when the request does. The signal is checked before the timer is created, which
closes the window in which an abort arriving at the wrong moment could otherwise be missed.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable

from app.ai.utils.abort import AbortError, AbortSignal, abort_reason

__all__ = ["sleep"]


def sleep(ms: float, signal: AbortSignal) -> Awaitable[None]:
    """Wait ``ms`` milliseconds, or stop early with the signal's reason.

    The returned awaitable fails with the signal's reason, or with an
    :class:`~app.ai.utils.abort.AbortError` when the signal carries none.
    """

    return _sleep(ms, signal)


async def _sleep(ms: float, signal: AbortSignal) -> None:
    if signal.aborted:
        raise _as_error(abort_reason(signal))

    aborted: asyncio.Future[None] = asyncio.get_running_loop().create_future()

    def on_abort() -> None:
        if not aborted.done():
            aborted.set_result(None)

    signal.add_listener(on_abort, once=True)
    waiting = asyncio.ensure_future(asyncio.sleep(ms / 1000))
    try:
        done, _pending = await asyncio.wait(
            {waiting, aborted},
            return_when=asyncio.FIRST_COMPLETED,
        )
    finally:
        signal.remove_listener(on_abort)

    if aborted in done:
        waiting.cancel()
        raise _as_error(abort_reason(signal))
    await waiting


def _as_error(reason: object) -> BaseException:
    """Coerce a signal reason into something raisable."""

    if isinstance(reason, BaseException):
        return reason
    return AbortError() if reason is None else AbortError(str(reason))
