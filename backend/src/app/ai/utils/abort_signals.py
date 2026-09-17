"""Combines several cancellation signals into the single signal a request observes."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from app.ai.utils.abort import AbortController, AbortSignal


@dataclass(slots=True)
class CombinedAbortSignal:
    """The combined signal plus the cleanup that detaches its subscriptions.

    ``signal`` is absent when no input signal was supplied; a caller that requires one
    falls back to a fresh controller.
    """

    signal: AbortSignal | None = None
    cleanup: Callable[[], None] = field(default=lambda: None)


def combine_abort_signals(signals: Sequence[AbortSignal | None]) -> CombinedAbortSignal:
    """Merge input signals so that aborting any one of them aborts the result.

    A single input is returned unchanged and nothing is allocated. The caller owns the
    result and must call ``cleanup`` once the request finishes.
    """

    active = [signal for signal in signals if signal is not None]
    if not active:
        return CombinedAbortSignal()
    if len(active) == 1:
        return CombinedAbortSignal(signal=active[0])

    controller = AbortController()
    listeners: list[tuple[AbortSignal, Callable[[], None]]] = []

    def abort_from(signal: AbortSignal) -> None:
        # The first input to abort wins; later ones leave the combined reason untouched.
        if not controller.signal.aborted:
            controller.abort(signal.reason)

    for signal in active:
        if signal.aborted:
            # Stop at the first already-aborted input instead of subscribing to the rest.
            abort_from(signal)
            break
        listener = _listener_for(signal, abort_from)
        signal.add_listener(listener, once=True)
        listeners.append((signal, listener))

    def cleanup() -> None:
        for signal, listener in listeners:
            signal.remove_listener(listener)

    return CombinedAbortSignal(signal=controller.signal, cleanup=cleanup)


def _listener_for(
    signal: AbortSignal,
    abort_from: Callable[[AbortSignal], None],
) -> Callable[[], None]:
    """Build the zero-argument listener that reports ``signal`` as the aborted input."""

    def listener() -> None:
        abort_from(signal)

    return listener
