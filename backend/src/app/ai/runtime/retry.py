"""Separate request-establishment retries from optional whole-assistant retries."""

from __future__ import annotations

import asyncio
import math
import re
from asyncio import sleep as _sleep
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from random import random as _random
from time import time as _now


@dataclass(frozen=True)
class ProviderErrorInfo:
    """Retry-relevant transport evidence, not a public error taxonomy."""

    status: int | None
    headers: Mapping[str, str]


def provider_error_info(error: Exception) -> ProviderErrorInfo | None:
    """Recognize connection errors or an explicitly shaped provider exception."""
    if isinstance(error, (ConnectionError, TimeoutError)):
        return ProviderErrorInfo(None, {})
    status, headers = getattr(error, "status", None), getattr(error, "headers", None)
    if (
        hasattr(error, "status")
        and (status is None or type(status) is int)
        and isinstance(headers, Mapping)
    ):
        return ProviderErrorInfo(status, headers)
    return None


async def retry_provider_request[T](
    request: Callable[[], Awaitable[T]],
    *,
    max_retries: int = 0,
    max_retry_delay_ms: float = 60000,
    signal: asyncio.Event | None = None,
    error_info: Callable[[Exception], ProviderErrorInfo | None] = provider_error_info,
) -> T:
    """Retry establishment only; return ownership of an acquired response to the caller."""
    if type(max_retries) is not int or max_retries < 0:
        raise ValueError("max_retries must be a nonnegative integer")
    if not math.isfinite(max_retry_delay_ms) or max_retry_delay_ms < 0:
        raise ValueError("max_retry_delay_ms must be finite and nonnegative")
    for attempt in range(max_retries + 1):
        try:
            return await wait_with_signal(request(), signal)
        except SignalAborted:
            raise
        except Exception as error:
            info = error_info(error)
            if attempt == max_retries or info is None:
                raise
            headers = {k.lower(): v for k, v in info.headers.items()}
            override = headers.get("x-should-retry")
            permitted = override == "true" or (
                override != "false"
                and (info.status is None or info.status in {408, 409, 429} or info.status >= 500)
            )
            if not permitted:
                raise
            await wait_with_signal(
                _sleep(_retry_delay(headers, attempt, max_retry_delay_ms)), signal
            )
    raise AssertionError("unreachable")


class SignalAborted(Exception):
    """Explicit call signal, distinct from cancellation of the caller's Python task."""


async def wait_with_signal[T](operation: Awaitable[T], signal: asyncio.Event | None) -> T:
    """Cancel and drain owned work when signaled; never abandon its coroutine."""
    if signal is None:
        return await operation
    work = asyncio.ensure_future(operation)
    watcher = asyncio.create_task(signal.wait())
    try:
        if signal.is_set():
            raise SignalAborted("Request aborted")
        done, _ = await asyncio.wait((work, watcher), return_when=asyncio.FIRST_COMPLETED)
        if watcher in done:
            raise SignalAborted("Request aborted")
        return await work
    finally:
        for task in (work, watcher):
            if not task.done():
                task.cancel()
        await asyncio.gather(work, watcher, return_exceptions=True)


def _parse_number(value: str) -> float | None:
    """Match the numeric prefix accepted by pi's parseFloat."""
    match = re.match(r"^[\s]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)", value)
    if not match:
        return None
    return float(match[1])


def _retry_delay(headers: Mapping[str, str], attempt: int, maximum_ms: float) -> float:
    """Resolve server instructions before applying the local jitter policy."""
    milliseconds = _parse_number(headers.get("retry-after-ms", ""))
    if milliseconds is None and headers.get("retry-after"):
        raw = headers["retry-after"]
        seconds = _parse_number(raw)
        if seconds is not None:
            milliseconds = seconds * 1000
        else:
            try:
                milliseconds = (parsedate_to_datetime(raw).timestamp() - _now()) * 1000
            except (ValueError, TypeError, OverflowError):
                milliseconds = 0
    if milliseconds is not None:
        if maximum_ms > 0 and milliseconds > maximum_ms:
            raise ValueError(
                f"Server requested {milliseconds / 1000:g}s retry delay "
                f"(max: {maximum_ms / 1000:g}s)"
            )
        return max(0, milliseconds) / 1000
    return float(min(0.5 * 2 ** min(attempt, 4), 8) * (1 - _random() * 0.25))
