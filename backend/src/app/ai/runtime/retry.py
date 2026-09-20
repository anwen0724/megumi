"""Separate request-establishment retries from optional whole-assistant retries."""

from __future__ import annotations

import asyncio
import math
import re
from asyncio import sleep as _sleep
from collections.abc import Awaitable, Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from inspect import isawaitable
from random import random as _random
from time import time as _now

from app.ai.messages import AssistantMessage
from app.ai.options import RetryCallbacks, RetryPolicy


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
                _sleep(_retry_delay(headers, attempt, max_retry_delay_ms, str(error))), signal
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


def _retry_delay(
    headers: Mapping[str, str], attempt: int, maximum_ms: float, provider_message: str
) -> float:
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
                f"Server requested {math.ceil(milliseconds / 1000)}s retry delay "
                f"(max: {math.ceil(maximum_ms / 1000)}s). {provider_message}"
            )
        return max(0, milliseconds) / 1000
    return float(min(0.5 * 2 ** min(attempt, 4), 8) * (1 - _random() * 0.25))


_NON_RETRYABLE = re.compile(
    r"GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance"
    r"|insufficient_quota|out of budget|quota exceeded|billing",
    re.I,
)
_RETRYABLE = re.compile(
    "|".join(
        [
            r"overloaded",
            r"currently experiencing high demand",
            r"rate.?limit",
            r"too many requests",
            r"429",
            r"500",
            r"502",
            r"503",
            r"504",
            r"520",
            r"524",
            r"service.?unavailable",
            r"server.?error",
            r"internal.?error",
            r"provider.?returned.?error",
            r"exceeded request buffer limit while retrying upstream",
            r"network.?error",
            r"connection.?error",
            r"connection.?refused",
            r"connection.?lost",
            r"other side closed",
            r"fetch failed",
            r"getaddrinfo",
            r"ENOTFOUND",
            r"EAI_AGAIN",
            r"upstream.?connect",
            r"reset before headers",
            r"socket hang up",
            r"socket connection was closed",
            r"timed? out",
            r"timeout",
            r"terminated",
            r"websocket.?closed",
            r"websocket.?error",
            r"ended without",
            r"stream ended before message_stop",
            r"stream ended before a terminal response event",
            r"http2 request did not get a response",
            r"retry delay",
            r"you can retry your request",
            r"try your request again",
            r"please retry your request",
            r"ResourceExhausted",
        ]
    ),
    re.I,
)


def is_retryable_assistant_error(message: AssistantMessage) -> bool:
    """Apply pi's transient-error classifier after excluding account limits."""
    text = message.error_message or ""
    return (
        message.stop_reason == "error"
        and not _NON_RETRYABLE.search(text)
        and bool(_RETRYABLE.search(text))
    )


async def _await_callback(value: Awaitable[None] | None) -> None:
    if isawaitable(value):
        await value


async def retry_assistant_call(
    produce: Callable[[], Awaitable[AssistantMessage]],
    policy: RetryPolicy | None = None,
    *,
    signal: asyncio.Event | None = None,
    callbacks: RetryCallbacks | None = None,
) -> AssistantMessage:
    """Retry only returned transient errors; production and callback exceptions propagate."""
    maximum = policy.max_retries if policy and policy.enabled else 0
    if type(maximum) is not int or maximum < 0:
        raise ValueError("max_retries must be a nonnegative integer")
    if policy and any(
        not math.isfinite(v) or v < 0 for v in (policy.base_delay_ms, policy.max_agent_delay_ms)
    ):
        raise ValueError("Retry delays must be finite and nonnegative")
    hooks = callbacks or RetryCallbacks()
    attempt = 0
    while True:
        response = await produce()
        if (
            response.stop_reason != "error"
            or attempt >= maximum
            or not is_retryable_assistant_error(response)
        ):
            if attempt and hooks.finished:
                await _await_callback(
                    hooks.finished(
                        response.stop_reason not in {"error", "aborted"},
                        attempt,
                        response.error_message if response.stop_reason == "error" else None,
                    )
                )
            return response
        assert policy is not None
        attempt += 1
        # Cap the exponent before float conversion; huge retry budgets must not overflow.
        delay = min(policy.base_delay_ms * 2.0 ** min(attempt - 1, 1023), policy.max_agent_delay_ms)
        error = response.error_message or "Unknown error"
        if hooks.scheduled:
            await _await_callback(hooks.scheduled(attempt, maximum, delay, error))
        try:
            await wait_with_signal(_sleep(delay / 1000), signal)
        except SignalAborted:
            if hooks.finished:
                await _await_callback(hooks.finished(False, attempt, error))
            aborted = deepcopy(response)
            aborted.stop_reason = "aborted"
            aborted.error_message = None
            return aborted
        if hooks.attempt_start:
            await _await_callback(hooks.attempt_start())
