"""A telemetry context that records nothing.

Used when an application supplies no adapter; spans and events are accepted and
discarded so that instrumented code paths need no branching.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from app.telemetry import SpanAttributes, SpanOptions, SpanStatus, TelemetrySpan

__all__ = ["NOOP_TELEMETRY_CONTEXT"]


async def _start_noop_span[T](
    _options: SpanOptions,
    callback: Callable[[TelemetrySpan], T | Awaitable[T]],
) -> T:
    """Run the callback against the shared no-op span and pass its outcome through."""

    result = callback(NOOP_TELEMETRY_CONTEXT)
    if isinstance(result, Awaitable):
        return await result
    return result


class _NoopTelemetrySpan:
    """A span that accepts every call and keeps none of it."""

    def startSpan[T](
        self,
        options: SpanOptions,
        callback: Callable[[TelemetrySpan], T | Awaitable[T]],
    ) -> Awaitable[T]:
        return _start_noop_span(options, callback)

    def addEvent(self, name: str, attributes: SpanAttributes | None = None) -> None:
        del name, attributes

    def setAttributes(self, attributes: SpanAttributes) -> None:
        del attributes

    def setStatus(self, status: SpanStatus) -> None:
        del status


# The shared telemetry context, used when an application does not provide one.
NOOP_TELEMETRY_CONTEXT: TelemetrySpan = _NoopTelemetrySpan()
