"""Tests for the bridge between synchronous callers and asynchronous work.

The cases pin the two properties the provider contract relies on: that the synchronous
prefix of a coroutine runs before the starting call returns, and that the result composes
with ``await`` from inside another coroutine.
"""

from __future__ import annotations

import asyncio

import pytest

from app.ai.utils.awaitable import AwaitableResult


@pytest.mark.asyncio
async def test_completes_synchronously_without_suspending() -> None:
    async def immediate() -> int:
        return 1

    assert await AwaitableResult(immediate()) == 1


@pytest.mark.asyncio
async def test_surfaces_a_failure_raised_before_the_first_await() -> None:
    async def immediate_failure() -> None:
        raise ValueError("early")

    result = AwaitableResult(immediate_failure())

    with pytest.raises(ValueError, match="early"):
        await result


@pytest.mark.asyncio
async def test_admits_the_synchronous_prefix_before_returning() -> None:
    admitted = False

    async def body(flag: int) -> int:
        return flag

    def start() -> AwaitableResult[int]:
        nonlocal admitted
        admitted = True
        return AwaitableResult(body(42))

    result = start()

    assert admitted is True
    assert await result == 42


@pytest.mark.asyncio
async def test_suspends_on_a_future_and_resumes_with_its_result() -> None:
    released = asyncio.Event()

    async def wait_for_release() -> str:
        await released.wait()
        return "released"

    result = AwaitableResult(wait_for_release())
    assert not released.is_set()

    released.set()

    assert await result == "released"


@pytest.mark.asyncio
async def test_propagates_a_failure_that_arrives_after_suspending() -> None:
    released = asyncio.Event()

    async def wait_then_fail() -> None:
        await released.wait()
        raise RuntimeError("late")

    result = AwaitableResult(wait_then_fail())
    released.set()

    with pytest.raises(RuntimeError, match="late"):
        await result


@pytest.mark.asyncio
async def test_nests_inside_another_coroutine() -> None:
    released = asyncio.Event()

    async def wait_for_release() -> str:
        await released.wait()
        return "released"

    async def outer(inner: AwaitableResult[str]) -> str:
        return await inner

    nested = AwaitableResult(outer(AwaitableResult(wait_for_release())))
    released.set()

    assert await nested == "released"


@pytest.mark.asyncio
async def test_awaits_only_once_when_awaited_twice() -> None:
    calls = 0

    async def counted() -> int:
        nonlocal calls
        calls += 1
        return calls

    result = AwaitableResult(counted())

    assert await result == 1
    assert await result == 1
    assert calls == 1
