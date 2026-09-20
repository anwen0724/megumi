"""Tests for the cancellation primitives.

The cases cover what callers depend on: subscribing never misses an abort that already
happened, only the first abort takes effect, and abandoning an operation raises its reason
without leaving the abandoned work unobserved.
"""

from __future__ import annotations

import asyncio

import pytest

from app.ai.utils.abort import (
    AbortController,
    AbortError,
    AbortSignal,
    abort_reason,
    operation_signal,
    race_with_abort_signal,
)
from app.ai.utils.abort_signals import combine_abort_signals


def test_a_new_signal_is_not_aborted() -> None:
    signal = AbortSignal()

    assert signal.aborted is False
    assert signal.reason is None


def test_abort_marks_the_signal_and_keeps_the_reason() -> None:
    controller = AbortController()

    controller.abort("because")

    assert controller.signal.aborted is True
    assert controller.signal.reason == "because"


def test_only_the_first_abort_takes_effect() -> None:
    controller = AbortController()

    controller.abort("first")
    controller.abort("second")

    assert controller.signal.reason == "first"


def test_listeners_are_notified_in_subscription_order() -> None:
    controller = AbortController()
    order: list[str] = []
    controller.signal.add_listener(lambda: order.append("first"))
    controller.signal.add_listener(lambda: order.append("second"))

    controller.abort()

    assert order == ["first", "second"]


def test_subscribing_to_an_aborted_signal_notifies_immediately() -> None:
    controller = AbortController()
    controller.abort("done")
    seen: list[str] = []

    controller.signal.add_listener(lambda: seen.append("late"))

    assert seen == ["late"]


def test_removed_listeners_are_not_notified() -> None:
    controller = AbortController()
    seen: list[str] = []

    def listener() -> None:
        seen.append("called")

    controller.signal.add_listener(listener)
    controller.signal.remove_listener(listener)
    controller.abort()

    assert seen == []


def test_a_listener_is_notified_once_per_abort() -> None:
    controller = AbortController()
    calls = 0

    def listener() -> None:
        nonlocal calls
        calls += 1

    controller.signal.add_listener(listener, once=True)
    controller.abort()
    controller.abort()

    assert calls == 1


def test_abort_reason_prefers_the_supplied_reason() -> None:
    controller = AbortController()
    controller.abort("supplied")

    assert abort_reason(controller.signal) == "supplied"


def test_abort_reason_falls_back_to_an_abort_error() -> None:
    reason = abort_reason(AbortSignal())

    assert isinstance(reason, AbortError)
    assert reason.name == "AbortError"
    assert str(reason) == "The operation was aborted"


def test_operation_signal_returns_the_callers_signal() -> None:
    controller = AbortController()

    assert operation_signal(controller.signal) is controller.signal


def test_operation_signal_invents_one_when_absent() -> None:
    signal = operation_signal(None)

    assert isinstance(signal, AbortSignal)
    assert signal.aborted is False


@pytest.mark.asyncio
async def test_race_returns_the_operation_result_when_it_wins() -> None:
    controller = AbortController()

    async def operation() -> str:
        return "finished"

    assert await race_with_abort_signal(operation(), controller.signal) == "finished"
    assert controller.signal.aborted is False


@pytest.mark.asyncio
async def test_race_raises_the_reason_when_the_signal_wins() -> None:
    controller = AbortController()
    release = asyncio.Event()

    async def operation() -> str:
        await release.wait()
        return "late"

    racing = asyncio.ensure_future(race_with_abort_signal(operation(), controller.signal))
    await asyncio.sleep(0)
    controller.abort("cancelled")

    with pytest.raises(AbortError) as caught:
        await racing
    assert str(caught.value) == "cancelled"

    # The abandoned operation is still observed, so its result is never unhandled.
    release.set()
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_race_raises_an_abort_error_without_a_reason() -> None:
    controller = AbortController()

    async def operation() -> None:
        await asyncio.sleep(60)

    racing = asyncio.ensure_future(race_with_abort_signal(operation(), controller.signal))
    await asyncio.sleep(0)
    controller.abort()

    with pytest.raises(AbortError):
        await racing


@pytest.mark.asyncio
async def test_race_on_an_already_aborted_signal_never_starts_waiting() -> None:
    controller = AbortController()
    controller.abort("already")
    started = False

    async def operation() -> None:
        nonlocal started
        started = True

    with pytest.raises(AbortError, match="already"):
        await race_with_abort_signal(operation(), controller.signal)

    assert started is False


@pytest.mark.asyncio
async def test_race_propagates_the_operations_own_failure() -> None:
    controller = AbortController()

    async def operation() -> None:
        raise ValueError("failed")

    with pytest.raises(ValueError, match="failed"):
        await race_with_abort_signal(operation(), controller.signal)


def test_combining_nothing_yields_no_signal() -> None:
    combined = combine_abort_signals([])

    assert combined.signal is None
    combined.cleanup()


def test_combining_none_arguments_yields_no_signal() -> None:
    combined = combine_abort_signals([None, None])

    assert combined.signal is None


def test_combining_one_signal_returns_it_unchanged() -> None:
    controller = AbortController()

    combined = combine_abort_signals([None, controller.signal])

    assert combined.signal is controller.signal


def test_each_input_can_abort_the_combined_signal() -> None:
    first = AbortController()
    second = AbortController()
    combined = combine_abort_signals([first.signal, second.signal])

    second.abort("from second")

    assert combined.signal is not None
    assert combined.signal.aborted is True
    assert combined.signal.reason == "from second"
    combined.cleanup()


def test_the_first_input_to_abort_wins() -> None:
    first = AbortController()
    second = AbortController()
    combined = combine_abort_signals([first.signal, second.signal])

    first.abort("first")
    second.abort("second")

    assert combined.signal is not None
    assert combined.signal.reason == "first"
    combined.cleanup()


def test_combining_an_already_aborted_input_aborts_immediately() -> None:
    aborted = AbortController()
    aborted.abort("already")
    live = AbortController()

    combined = combine_abort_signals([live.signal, aborted.signal])

    assert combined.signal is not None
    assert combined.signal.aborted is True
    assert combined.signal.reason == "already"
    combined.cleanup()


def test_cleanup_detaches_the_subscriptions() -> None:
    first = AbortController()
    second = AbortController()
    combined = combine_abort_signals([first.signal, second.signal])
    combined.cleanup()

    first.abort("ignored")

    assert combined.signal is not None
    assert combined.signal.aborted is False


def test_combined_signal_reason_survives_cleanup() -> None:
    first = AbortController()
    second = AbortController()
    combined = combine_abort_signals([first.signal, second.signal])

    first.abort("kept")
    combined.cleanup()

    assert combined.signal is not None
    assert combined.signal.reason == "kept"
