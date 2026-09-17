"""Tests for the telemetry contracts and the in-memory recording adapter.

The cases pin the behaviours that callers of the contract depend on: that a span is
admitted before the starting call returns, that the recorded span settles with the work
it measures, and that recording never changes how the measured work behaves.
"""

from __future__ import annotations

import asyncio

import pytest

from app.telemetry import SpanOptions, SpanStatus, TelemetryContext, TelemetrySpan
from app.telemetry.memory import InMemoryTelemetryContext, RecordedTelemetrySpan
from app.telemetry.noop import NOOP_TELEMETRY_CONTEXT


def _find(spans: list[RecordedTelemetrySpan], name: str) -> RecordedTelemetrySpan:
    """Return the single recorded span with ``name``."""

    for span in spans:
        if span.name == name:
            return span
    raise AssertionError(f"no recorded span named {name!r}")


@pytest.mark.asyncio
async def test_admits_callback_synchronously_and_preserves_result() -> None:
    telemetry = InMemoryTelemetryContext()
    admitted = False
    calls = 0
    expected = object()

    def callback(_span: TelemetrySpan) -> object:
        nonlocal admitted, calls
        admitted = True
        calls += 1
        return expected

    result = telemetry.startSpan(SpanOptions(name="success"), callback)

    assert admitted is True
    assert calls == 1
    assert await result is expected

    span = _find(telemetry.getSpans(), "success")
    assert span.status == SpanStatus(status="ok")
    assert span.settled is True


@pytest.mark.asyncio
async def test_preserves_the_callbacks_own_error() -> None:
    telemetry = InMemoryTelemetryContext()
    error = ValueError("sync")

    def raising(_span: TelemetrySpan) -> None:
        raise error

    with pytest.raises(ValueError) as caught:
        await telemetry.startSpan(SpanOptions(name="sync-error"), raising)
    assert caught.value is error

    async def rejecting(_span: TelemetrySpan) -> None:
        raise error

    with pytest.raises(ValueError) as caught:
        await telemetry.startSpan(SpanOptions(name="async-error"), rejecting)
    assert caught.value is error

    spans = telemetry.getSpans()
    assert _find(spans, "sync-error").status.status == "error"
    assert _find(spans, "sync-error").status.error is not None
    assert _find(spans, "sync-error").status.error.name == "ValueError"
    assert _find(spans, "async-error").status.status == "error"


@pytest.mark.asyncio
async def test_explicit_status_outranks_automatic_failure() -> None:
    telemetry = InMemoryTelemetryContext()

    def last_explicit_status_wins(span: TelemetrySpan) -> None:
        span.setStatus(SpanStatus(status="error", error=None))
        span.setStatus(SpanStatus(status="ok"))

    await telemetry.startSpan(SpanOptions(name="last-status"), last_explicit_status_wins)

    def explicit_then_raise(span: TelemetrySpan) -> None:
        span.setStatus(SpanStatus(status="ok"))
        raise RuntimeError("after explicit status")

    with pytest.raises(RuntimeError):
        await telemetry.startSpan(SpanOptions(name="explicit-before-throw"), explicit_then_raise)

    spans = telemetry.getSpans()
    assert _find(spans, "last-status").status == SpanStatus(status="ok")
    assert _find(spans, "explicit-before-throw").status == SpanStatus(status="ok")


@pytest.mark.asyncio
async def test_merges_attributes_and_records_ordered_events() -> None:
    telemetry = InMemoryTelemetryContext()

    def callback(span: TelemetrySpan) -> None:
        span.setAttributes({"count": 1, "overwrite": "middle"})
        span.setAttributes({"count": None, "overwrite": "end"})
        span.addEvent("first", {"index": 1, "ignored": None})
        span.addEvent("second", {"index": 2})

    await telemetry.startSpan(
        SpanOptions(
            name="recording",
            attributes={"start": "value", "overwrite": "start", "ignored": None},
        ),
        callback,
    )

    span = _find(telemetry.getSpans(), "recording")
    assert span.attributes == {"start": "value", "overwrite": "end", "count": 1}
    assert [(event.name, event.attributes) for event in span.events] == [
        ("first", {"index": 1}),
        ("second", {"index": 2}),
    ]


@pytest.mark.asyncio
async def test_calls_after_settlement_are_inert() -> None:
    telemetry = InMemoryTelemetryContext()
    captured: list[TelemetrySpan] = []

    await telemetry.startSpan(
        SpanOptions(name="settled", attributes={"value": "initial"}),
        lambda span: captured.append(span),
    )
    span = captured[0]

    span.setAttributes({"value": "late"})
    span.addEvent("late", {"value": True})
    span.setStatus(SpanStatus(status="error"))
    child_admitted = False

    def child(_span: TelemetrySpan) -> int:
        nonlocal child_admitted
        child_admitted = True
        return 7

    assert await span.startSpan(SpanOptions(name="late-child"), child) == 7
    assert child_admitted is True

    spans = telemetry.getSpans()
    assert len(spans) == 1
    assert spans[0].attributes == {"value": "initial"}
    assert spans[0].events == []
    assert spans[0].status == SpanStatus(status="ok")


@pytest.mark.asyncio
async def test_records_nested_and_concurrent_children() -> None:
    telemetry = InMemoryTelemetryContext()
    release_first = asyncio.Event()

    async def parent(span: TelemetrySpan) -> None:
        async def first_child(_span: TelemetrySpan) -> None:
            await release_first.wait()

        first = span.startSpan(SpanOptions(name="first-child"), first_child)
        second = span.startSpan(SpanOptions(name="second-child"), lambda _span: "done")
        assert await second == "done"
        release_first.set()
        await first

    await telemetry.startSpan(SpanOptions(name="parent"), parent)

    spans = telemetry.getSpans()
    recorded_parent = _find(spans, "parent")
    recorded_first = _find(spans, "first-child")
    recorded_second = _find(spans, "second-child")

    assert recorded_parent.parentId is None
    assert recorded_first.parentId == recorded_parent.id
    assert recorded_second.parentId == recorded_parent.id
    assert recorded_second.endSequence is not None
    assert recorded_first.endSequence is not None
    assert recorded_parent.endSequence is not None
    assert recorded_second.endSequence < recorded_first.endSequence < recorded_parent.endSequence


@pytest.mark.asyncio
async def test_snapshots_are_detached_from_later_recording() -> None:
    telemetry = InMemoryTelemetryContext()
    attributes = {"shared": ["before"]}

    await telemetry.startSpan(
        SpanOptions(name="detached", attributes=attributes),
        lambda _span: None,
    )
    attributes["shared"].append("after")

    snapshot = _find(telemetry.getSpans(), "detached")
    assert snapshot.attributes == {"shared": ["before"]}


@pytest.mark.asyncio
async def test_noop_context_runs_work_without_recording() -> None:
    calls = 0

    def callback(_span: TelemetrySpan) -> int:
        nonlocal calls
        calls += 1
        return 9

    assert isinstance(NOOP_TELEMETRY_CONTEXT, TelemetryContext)
    assert await NOOP_TELEMETRY_CONTEXT.startSpan(SpanOptions(name="unrecorded"), callback) == 9
    assert calls == 1


@pytest.mark.asyncio
async def test_noop_context_propagates_failure() -> None:
    def raising(_span: TelemetrySpan) -> None:
        raise RuntimeError("failed")

    with pytest.raises(RuntimeError, match="failed"):
        await NOOP_TELEMETRY_CONTEXT.startSpan(SpanOptions(name="failed"), raising)
