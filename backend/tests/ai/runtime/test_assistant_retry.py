"""Whole-assistant retry is opt-in and never joins generated answers."""

import asyncio

import pytest

from app.ai.messages import AssistantMessage, TextContent
from app.ai.options import RetryCallbacks, RetryPolicy
from app.ai.runtime import retry
from app.ai.runtime.retry import retry_assistant_call


def message(reason="stop", error=None, text="answer"):
    return AssistantMessage(
        content=[TextContent(text=text)],
        provider="p",
        api="a",
        model="m",
        timestamp=1,
        stop_reason=reason,
        error_message=error,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["stop", "length", "tool_use", "aborted", "error"])
async def test_no_policy_runs_produce_once(reason):
    result = message(reason, "network error" if reason == "error" else None)
    calls = []

    async def produce():
        calls.append(1)
        return result

    assert await retry_assistant_call(produce) is result
    assert calls == [1]


@pytest.mark.asyncio
async def test_transient_retry_callbacks_and_independent_answers(monkeypatch):
    order = []
    responses = [message("error", "network error", "partial"), message(text="fresh")]

    async def sleep(seconds):
        order.append(("wait", seconds))

    monkeypatch.setattr(retry, "_sleep", sleep)

    async def produce():
        order.append("produce")
        return responses.pop(0)

    callbacks = RetryCallbacks(
        scheduled=lambda attempt, maximum, delay, error: order.append(
            ("scheduled", attempt, maximum, delay, error)
        ),
        attempt_start=lambda: order.append("start"),
        finished=lambda success, attempt, error: order.append(
            ("finished", success, attempt, error)
        ),
    )
    result = await retry_assistant_call(
        produce, RetryPolicy(enabled=True, max_retries=2, base_delay_ms=1000), callbacks=callbacks
    )
    assert result.content[0].text == "fresh"
    assert order == [
        "produce",
        ("scheduled", 1, 2, 1000, "network error"),
        ("wait", 1),
        "start",
        "produce",
        ("finished", True, 1, None),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        "insufficient_quota 429",
        "billing server error",
        "GoUsageLimitError",
        "quota exceeded",
        "invalid tool",
    ],
)
async def test_account_exhaustion_and_deterministic_error_are_not_retried(error):
    calls = []
    result = message("error", error)

    async def produce():
        calls.append(1)
        return result

    assert (
        await retry_assistant_call(
            produce, RetryPolicy(enabled=True, max_retries=2, base_delay_ms=0)
        )
        is result
    )
    assert calls == [1]


@pytest.mark.asyncio
async def test_retry_delay_cap_and_exhaustion(monkeypatch):
    waits = []
    finished = []
    calls = []

    async def sleep(seconds):
        waits.append(seconds)

    monkeypatch.setattr(retry, "_sleep", sleep)

    async def produce():
        calls.append(1)
        return message("error", "503 unavailable")

    hooks = RetryCallbacks(finished=lambda *args: finished.append(args))
    result = await retry_assistant_call(
        produce,
        RetryPolicy(enabled=True, max_retries=3, base_delay_ms=1000, max_agent_delay_ms=1500),
        callbacks=hooks,
    )
    assert result.stop_reason == "error"
    assert len(calls) == 4 and waits == [1, 1.5, 1.5]
    assert finished == [(False, 3, "503 unavailable")]
    waits.clear()
    await retry_assistant_call(
        produce, RetryPolicy(enabled=True, max_retries=1, base_delay_ms=1000, max_agent_delay_ms=0)
    )
    assert waits == [0]


@pytest.mark.asyncio
async def test_signal_abort_returns_copy_and_external_task_cancel_propagates(monkeypatch):
    entered = asyncio.Event()
    signal = asyncio.Event()
    finished = []
    original = message("error", "network error", "partial")

    async def sleep(seconds):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(retry, "_sleep", sleep)

    async def produce():
        return original

    policy = RetryPolicy(enabled=True, max_retries=2, base_delay_ms=1000)
    hooks = RetryCallbacks(finished=lambda *args: finished.append(args))
    task = asyncio.create_task(
        retry_assistant_call(produce, policy, signal=signal, callbacks=hooks)
    )
    await asyncio.wait_for(entered.wait(), 1)
    signal.set()
    result = await asyncio.wait_for(task, 1)
    assert result.stop_reason == "aborted" and result.error_message is None
    assert result.content[0].text == "partial" and original.stop_reason == "error"
    result.content[0].text = "other"
    assert original.content[0].text == "partial"
    assert finished == [(False, 1, "network error")]
    entered.clear()
    task = asyncio.create_task(retry_assistant_call(produce, policy))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["produce", "scheduled", "attempt_start", "finished"])
async def test_user_exceptions_propagate_without_an_extra_attempt(phase):
    calls = []

    async def fail(*args):
        raise LookupError(phase)

    async def produce():
        calls.append(1)
        if phase == "produce":
            raise LookupError(phase)
        return message("error", "network error") if len(calls) == 1 else message()

    hooks = RetryCallbacks(**({phase: fail} if phase != "produce" else {}))
    with pytest.raises(LookupError, match=phase):
        await retry_assistant_call(
            produce, RetryPolicy(enabled=True, max_retries=2, base_delay_ms=0), callbacks=hooks
        )
    assert len(calls) == (2 if phase == "finished" else 1)
