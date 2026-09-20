"""Vendor-neutral telemetry contracts.

A span is started together with the work it measures and ends when that work settles, so
there is no exporter, no global current-span state and no dependency on a telemetry
backend. An application supplies an adapter, or accepts the no-op context when it does
not care about telemetry.

Method names are camelCase to match the contract this module implements; ``None`` in an
attribute mapping means "not set", the way an absent or ``undefined`` property does.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

__all__ = [
    "NOOP_TELEMETRY_CONTEXT",
    "AttributeValue",
    "InMemoryTelemetryContext",
    "RecordedTelemetryEvent",
    "RecordedTelemetrySpan",
    "SpanAttributes",
    "SpanError",
    "SpanOptions",
    "SpanStatus",
    "TelemetryContext",
    "TelemetrySpan",
]

AttributeValue = str | int | float | bool | list[str] | list[int] | list[float] | list[bool]
SpanAttributes = dict[str, AttributeValue | None]


@dataclass(slots=True)
class SpanOptions:
    """The name and initial attributes of a span about to start."""

    name: str
    attributes: SpanAttributes | None = None


@dataclass(slots=True)
class SpanError:
    """The error recorded on a span that finished unsuccessfully."""

    name: str
    message: str


@dataclass(slots=True)
class SpanStatus:
    """How a span ended.

    ``status`` selects the shape: the ``ok`` status carries no error, and an ``error``
    status carries details only when they could be read from the failure.
    """

    status: Literal["ok", "error"]
    error: SpanError | None = None


@runtime_checkable
class TelemetryContext(Protocol):
    """Starts spans. An application supplies an adapter, or uses the no-op context."""

    def startSpan[T](
        self,
        options: SpanOptions,
        callback: Callable[[TelemetrySpan], T | Awaitable[T]],
    ) -> Awaitable[T]:
        """Run ``callback`` with a new span, ending the span when the callback settles.

        The callback must be admitted before this call returns, so that a synchronous
        body observes its span; the returned awaitable then settles with the callback's
        result, or fails with the callback's own error value.
        """

        ...


@runtime_checkable
class TelemetrySpan(TelemetryContext, Protocol):
    """A running span, which is itself a context so nested spans attach to it."""

    def addEvent(self, name: str, attributes: SpanAttributes | None = None) -> None:
        """Record a timestamped event on this span."""

        ...

    def setAttributes(self, attributes: SpanAttributes) -> None:
        """Merge attributes into this span."""

        ...

    def setStatus(self, status: SpanStatus) -> None:
        """Record how this span ended."""

        ...

