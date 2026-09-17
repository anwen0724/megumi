"""An in-memory recording telemetry adapter.

The adapter is backend neutral and keeps recorded spans in process memory so that
parentage, attribute merging and settling order are assertable. Create a fresh instance
to isolate tests or independent recording scopes.
"""

from __future__ import annotations

import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from app.ai.utils.awaitable import AwaitableResult
from app.telemetry import (
    AttributeValue,
    SpanAttributes,
    SpanError,
    SpanOptions,
    SpanStatus,
    TelemetrySpan,
)
from app.telemetry.noop import NOOP_TELEMETRY_CONTEXT

__all__ = [
    "InMemoryTelemetryContext",
    "RecordedTelemetryEvent",
    "RecordedTelemetrySpan",
]


@dataclass(slots=True)
class RecordedTelemetryEvent:
    """One event captured by the recording adapter."""

    name: str
    attributes: SpanAttributes


@dataclass(slots=True)
class RecordedTelemetrySpan:
    """One span captured by the recording adapter.

    ``endSequence`` orders spans by the moment they settled rather than by the moment
    they started, which is what makes concurrent children comparable.
    """

    id: int
    parentId: int | None
    name: str
    attributes: SpanAttributes
    events: list[RecordedTelemetryEvent]
    status: SpanStatus
    settled: bool
    endSequence: int | None = None


@dataclass(slots=True)
class _MutableRecordedSpan:
    """The live entry behind a running span; a snapshot is taken when it is read."""

    id: int
    parentId: int | None
    name: str
    attributes: SpanAttributes
    events: list[RecordedTelemetryEvent]
    status: SpanStatus
    explicitStatus: bool
    settled: bool
    endSequence: int | None = None


@dataclass(slots=True)
class _RecordingState:
    """The recording shared by one adapter instance and every span it starts."""

    spans: list[_MutableRecordedSpan] = field(default_factory=list)
    nextSpanId: int = 1
    nextEndSequence: int = 1


def _copy_list_attribute(value: list[str]) -> list[str]:
    """Copy one sequence attribute value."""

    return list(value)


def _copy_attribute_value(value: AttributeValue) -> AttributeValue:
    """Copy a sequence attribute so later mutation of the caller's list is not observed."""

    if isinstance(value, bool):
        return value
    if isinstance(value, list):
        # Every sequence shape copies the same way; ``list`` erases which element type it
        # held, but the branch that selected this value already fixed that.
        return _copy_list_attribute(value)  # type: ignore[arg-type]
    return value


def _copy_attributes(attributes: SpanAttributes | None) -> SpanAttributes:
    """Copy an attribute mapping, dropping entries that were left unset."""

    copy: SpanAttributes = {}
    if not attributes:
        return copy
    for name, value in attributes.items():
        if value is not None:
            copy[name] = _copy_attribute_value(value)
    return copy


def _merge_attributes(current: SpanAttributes, attributes: SpanAttributes) -> SpanAttributes:
    """Overlay attributes on a copy of the current ones, ignoring unset entries."""

    merged = _copy_attributes(current)
    for name, value in attributes.items():
        if value is not None:
            merged[name] = _copy_attribute_value(value)
    return merged


def _copy_status(status: SpanStatus) -> SpanStatus:
    """Detach a status from the caller's value, flattening it to a plain record."""

    if status.status == "ok":
        return SpanStatus(status="ok")
    if status.error is not None:
        return SpanStatus(
            status="error",
            error=type(status.error)(name=status.error.name, message=status.error.message),
        )
    return SpanStatus(status="error")


def _automatic_error_status(error: BaseException) -> SpanStatus:
    """Describe a failure automatically, without letting inspection fail the span."""

    try:
        # An explicit ``name`` (as on the abort error) is the error's own idea of its
        # identity; otherwise the type name stands in for it.
        name = getattr(error, "name", None) or type(error).__name__
        return SpanStatus(status="error", error=SpanError(name=name, message=str(error)))
    except Exception:
        return SpanStatus(status="error")


def _settle_span(
    state: _RecordingState,
    span: _MutableRecordedSpan,
    *,
    failed: bool,
    error: BaseException | None = None,
) -> None:
    """Mark a span settled once; an explicit status always outranks automatic detail."""

    if span.settled:
        return
    if failed and not span.explicitStatus and error is not None:
        span.status = _automatic_error_status(error)
    span.settled = True
    span.endSequence = state.nextEndSequence
    state.nextEndSequence += 1


class _InMemorySpan:
    """A running span backed by a recorded entry; nested spans name it as their parent."""

    def __init__(self, state: _RecordingState, recorded: _MutableRecordedSpan) -> None:
        self._state = state
        self._recorded = recorded

    def startSpan[T](
        self,
        options: SpanOptions,
        callback: Callable[[TelemetrySpan], T | Awaitable[T]],
    ) -> Awaitable[T]:
        return _start_span(self._state, self._recorded, options, callback)

    def addEvent(self, name: str, attributes: SpanAttributes | None = None) -> None:
        if self._recorded.settled:
            return
        with contextlib.suppress(Exception):
            # Recording is passive: a payload that cannot be read must not fail the work.
            self._recorded.events.append(
                RecordedTelemetryEvent(name=name, attributes=_copy_attributes(attributes))
            )

    def setAttributes(self, attributes: SpanAttributes) -> None:
        if self._recorded.settled:
            return
        with contextlib.suppress(Exception):
            # Recording is passive: a payload that cannot be read must not fail the work.
            self._recorded.attributes = _merge_attributes(self._recorded.attributes, attributes)

    def setStatus(self, status: SpanStatus) -> None:
        if self._recorded.settled:
            return
        with contextlib.suppress(Exception):
            # Recording is passive: a payload that cannot be read must not fail the work.
            self._recorded.status = _copy_status(status)
            self._recorded.explicitStatus = True


def _start_span[T](
    state: _RecordingState,
    parent: _MutableRecordedSpan | None,
    options: SpanOptions,
    callback: Callable[[TelemetrySpan], T | Awaitable[T]],
) -> Awaitable[T]:
    """Record a span, admit the callback before returning, then settle the span."""

    if parent is not None and parent.settled:
        # A child of a settled span is not recorded; it still runs.
        return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback)

    try:
        recorded = _MutableRecordedSpan(
            id=state.nextSpanId,
            parentId=parent.id if parent is not None else None,
            name=options.name,
            attributes=_copy_attributes(options.attributes),
            events=[],
            status=SpanStatus(status="ok"),
            explicitStatus=False,
            settled=False,
        )
        state.nextSpanId += 1
        state.spans.append(recorded)

        span = _InMemorySpan(state, recorded)
        return AwaitableResult(_run_callback(state, recorded, span, callback))
    except RuntimeError:
        # Recording needs a running event loop to settle asynchronously; without one the
        # callback still runs, but nothing is recorded.
        return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback)


async def _run_callback[T](
    state: _RecordingState,
    recorded: _MutableRecordedSpan,
    span: _InMemorySpan,
    callback: Callable[[TelemetrySpan], T | Awaitable[T]],
) -> T:
    """Run the callback and settle the recorded span with its outcome."""

    try:
        result = callback(span)
        if isinstance(result, Awaitable):
            result = await result
    except BaseException as error:
        _settle_span(state, recorded, failed=True, error=error)
        raise
    _settle_span(state, recorded, failed=False)
    return result


def _snapshot(recorded: _MutableRecordedSpan) -> RecordedTelemetrySpan:
    """Detach a recorded entry so later recording cannot change an observed snapshot."""

    return RecordedTelemetrySpan(
        id=recorded.id,
        parentId=recorded.parentId,
        name=recorded.name,
        attributes=_copy_attributes(recorded.attributes),
        events=[
            RecordedTelemetryEvent(name=event.name, attributes=_copy_attributes(event.attributes))
            for event in recorded.events
        ],
        status=_copy_status(recorded.status),
        settled=recorded.settled,
        endSequence=recorded.endSequence,
    )


class InMemoryTelemetryContext:
    """A reference adapter that records spans in process memory."""

    def __init__(self) -> None:
        self._state = _RecordingState()

    def startSpan[T](
        self,
        options: SpanOptions,
        callback: Callable[[TelemetrySpan], T | Awaitable[T]],
    ) -> Awaitable[T]:
        return _start_span(self._state, None, options, callback)

    def getSpans(self) -> list[RecordedTelemetrySpan]:
        """Return detached snapshots in span-start order."""

        return [_snapshot(recorded) for recorded in self._state.spans]
