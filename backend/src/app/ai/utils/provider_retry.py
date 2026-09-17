"""Retries a single provider request the way the vendor SDKs would.

The vendor SDKs retry on their own, but their backoff timers ignore the request's
cancellation signal, so a caller cannot abandon a request that is waiting to be retried.
This module reproduces their retry decision — including the header a server uses to
overrule it — while making the wait interruptible, which is why callers invoke the SDK
with retries disabled and wrap the request here.

A server may ask for a delay longer than the caller is willing to wait. That is not a
retry the caller wants silently, so the request fails with the requested delay in the
message and lets higher-level logic decide.
"""

from __future__ import annotations

import asyncio
import email.utils
import math
import random
import time
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from app.ai.utils.abort import AbortError, AbortSignal

__all__ = ["DEFAULT_MAX_RETRY_DELAY_MS", "ProviderRetryOptions", "retryProviderRequest"]

DEFAULT_MAX_RETRY_DELAY_MS = 60_000

# Mirrors the pinned vendor SDK retry policy; review when either SDK is upgraded.
_RETRYABLE_STATUSES = frozenset({408, 409, 429})

# The backoff used when the server does not ask for a specific delay.
_BASE_BACKOFF_SECONDS = 0.5
_MAX_BACKOFF_SECONDS = 8.0
_BACKOFF_JITTER_SHARE = 0.25


class ProviderRetryOptions:
    """How many retries to allow, how long to wait at most, and how to cancel."""

    def __init__(
        self,
        *,
        maxRetries: int | None = None,
        maxRetryDelayMs: int | None = None,
        signal: AbortSignal | None = None,
    ) -> None:
        self.maxRetries = maxRetries
        self.maxRetryDelayMs = maxRetryDelayMs
        self.signal = signal


class ProviderError(Exception):
    """A provider failure carrying the HTTP status and response headers.

    Both fields are optional: a transport failure may have neither, which makes it
    retryable because nothing about it says the request is malformed.
    """

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.headers = headers


def _is_provider_error(error: Any) -> bool:
    """Whether ``error`` is a failure the retry policy can reason about."""

    if not isinstance(error, BaseException):
        return False
    if not hasattr(error, "status") or not hasattr(error, "headers"):
        return False
    status = error.status
    if status is not None and not isinstance(status, int):
        return False
    headers = error.headers
    return headers is None or isinstance(headers, Mapping)


def _header(error: Any, name: str) -> str | None:
    """Read a header from a provider error, ignoring case."""

    headers = error.headers
    if not isinstance(headers, Mapping):
        return None
    wanted = name.lower()
    for key, value in headers.items():
        if key.lower() == wanted:
            return value if isinstance(value, str) else None
    return None


def _is_retryable_provider_error(error: Any) -> bool:
    """Whether the provider or SDK says this request may be retried."""

    should_retry = _header(error, "x-should-retry")
    if should_retry == "true":
        return True
    if should_retry == "false":
        return False

    status = error.status
    if status is None:
        return True
    return status in _RETRYABLE_STATUSES or status >= 500


def _validate_server_retry_delay_ms(
    delay_ms: float,
    max_retry_delay_ms: int | None,
    error: Any,
) -> float:
    """Reject a server-requested delay the caller is unwilling to wait for.

    Failing here rather than waiting keeps a long server-mandated backoff visible to
    higher-level retry logic instead of silently stalling the request.
    """

    max_delay_ms = (
        DEFAULT_MAX_RETRY_DELAY_MS if max_retry_delay_ms is None else max_retry_delay_ms
    )
    if max_delay_ms > 0 and delay_ms > max_delay_ms:
        status = getattr(error, "status", None)
        raise ProviderError(
            f"Server requested {math.ceil(delay_ms / 1000)}s retry delay"
            f" (max: {math.ceil(max_delay_ms / 1000)}s). {error}",
            status=status if isinstance(status, int) else None,
        )
    return delay_ms


def _parse_retry_after_ms(value: str) -> float | None:
    """A ``retry-after`` header as milliseconds, whether it is a delay or a date.

    A header that is neither a number nor a date leaves the delay unknown, which lets the
    caller fall back to its own backoff.
    """

    try:
        return float(value) * 1000
    except ValueError:
        pass

    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    return (parsed.timestamp() - time.time()) * 1000


def _get_retry_delay_ms(error: Any, retry_index: int, max_retry_delay_ms: int | None) -> float:
    """How long to wait before the next attempt."""

    retry_after_ms = _header(error, "retry-after-ms")
    if retry_after_ms:
        try:
            return _validate_server_retry_delay_ms(
                float(retry_after_ms),
                max_retry_delay_ms,
                error,
            )
        except ValueError:
            pass

    retry_after = _header(error, "retry-after")
    if retry_after:
        delay_ms = _parse_retry_after_ms(retry_after)
        if delay_ms is not None:
            return _validate_server_retry_delay_ms(delay_ms, max_retry_delay_ms, error)

    exponential_delay: float = (
        min(_BASE_BACKOFF_SECONDS * 2**retry_index, _MAX_BACKOFF_SECONDS) * 1000
    )
    return exponential_delay * (1 - random.random() * _BACKOFF_JITTER_SHARE)


def _create_abort_error() -> AbortError:
    """The error a cancelled request fails with."""

    return AbortError("Request aborted")


async def _abortable_sleep(ms: float, signal: AbortSignal | None) -> None:
    """Wait, unless the signal aborts first, in which case the request was cancelled."""

    if signal is not None and signal.aborted:
        raise _create_abort_error()

    if signal is None:
        await asyncio.sleep(max(0, ms) / 1000)
        return

    aborted = asyncio.get_running_loop().create_future()

    def on_abort() -> None:
        if not aborted.done():
            aborted.set_result(None)

    signal.add_listener(on_abort, once=True)
    waiting = asyncio.ensure_future(asyncio.sleep(max(0, ms) / 1000))
    try:
        done, _pending = await asyncio.wait(
            {waiting, aborted},
            return_when=asyncio.FIRST_COMPLETED,
        )
    finally:
        signal.remove_listener(on_abort)

    if aborted in done:
        waiting.cancel()
        raise _create_abort_error()
    await waiting


async def retryProviderRequest[T](
    request: Callable[[], Awaitable[T]],
    options: ProviderRetryOptions | None = None,
) -> T:
    """Run ``request`` with bounded retries on transient provider failures."""

    resolved = options if options is not None else ProviderRetryOptions()
    max_retries = resolved.maxRetries or 0
    retries_remaining = max_retries

    while True:
        try:
            # Each retry is a fresh request, so the vendor SDK's retry counter stays zero.
            return await request()
        except BaseException as error:
            if resolved.signal is not None and resolved.signal.aborted:
                raise _create_abort_error() from None
            if (
                retries_remaining <= 0
                or not _is_provider_error(error)
                or not _is_retryable_provider_error(error)
            ):
                raise

            retry_index = max_retries - retries_remaining
            retries_remaining -= 1
            await _abortable_sleep(
                _get_retry_delay_ms(error, retry_index, resolved.maxRetryDelayMs),
                resolved.signal,
            )
