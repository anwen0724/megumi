"""Restarts a whole assistant turn when the failure looks transient.

This sits above the request-level retry: by the time a call fails here, the request has
already been retried as far as the transport allows, so a retry at this level means the
turn itself is repeated. Two things therefore matter. Retrying must be decided from the
failure text, because a turn that failed for a deterministic reason — an exhausted quota,
a rejected key — would fail identically again. And an abort must come back in the same
shape as a provider-side abort, so a caller does not have to know whether cancellation
happened while the request was running or while it was waiting to be retried.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace

from app.ai.types import AssistantMessage, StopReason
from app.ai.utils.abort import AbortSignal

__all__ = [
    "DEFAULT_MAX_AGENT_RETRY_DELAY_MS",
    "RetryCallbacks",
    "RetryPolicy",
    "isRetryableAssistantError",
    "retryAssistantCall",
    "retryDelayMs",
]

DEFAULT_MAX_AGENT_RETRY_DELAY_MS = 60_000

# Failures that describe an exhausted allowance rather than a transient fault. These are
# tested before the retryable patterns, because their wording overlaps.
_NON_RETRYABLE_PATTERNS = re.compile(
    "|".join(
        [
            r"GoUsageLimitError",
            r"FreeUsageLimitError",
            r"Monthly usage limit reached",
            r"available balance",
            r"insufficient_quota",
            r"out of budget",
            r"quota exceeded",
            r"billing",
        ],
    ),
    re.IGNORECASE,
)

_RETRYABLE_PATTERNS = re.compile(
    "|".join(
        [
            # Provider load, HTTP status and server-side transients.
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
            # A wrapper reporting that an upstream provider failed.
            r"provider.?returned.?error",
            r"exceeded request buffer limit while retrying upstream",
            # Network, proxy and fetch transport failures.
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
            # WebSocket transports report close and error text instead of HTTP text.
            r"websocket.?closed",
            r"websocket.?error",
            # Streams that ended before a terminal event.
            r"ended without",
            r"stream ended before message_stop",
            r"stream ended before a terminal response event",
            r"http2 request did not get a response",
            # A rejected server-requested delay should reach the outer policy.
            r"retry delay",
            # Explicit retry guidance emitted mid-stream.
            r"you can retry your request",
            r"try your request again",
            r"please retry your request",
            # gRPC-based providers.
            r"ResourceExhausted",
        ],
    ),
    re.IGNORECASE,
)


@dataclass(slots=True)
class RetryPolicy:
    """Bounded attempts with exponential backoff."""

    enabled: bool
    maxRetries: int
    baseDelayMs: int
    maxAgentDelayMs: int | None = None


@dataclass(slots=True)
class RetryCallbacks:
    """Notifications emitted around each retry attempt."""

    onRetryScheduled: Callable[[int, int, int, str], Awaitable[None] | None] | None = None
    onRetryAttemptStart: Callable[[], Awaitable[None] | None] | None = None
    onRetryFinished: Callable[[bool, int, str | None], Awaitable[None] | None] | None = None


class _RetrySleepAbortError(Exception):
    """Internal marker that the backoff wait was cancelled."""


def retryDelayMs(policy: RetryPolicy, attempt: int) -> int:
    """The delay before ``attempt``, doubling per attempt and capped.

    The first attempt waits the base delay. The cap applies to each computed delay, so an
    unbounded doubling cannot stall a caller indefinitely.
    """

    base_delay: int = policy.baseDelayMs
    delay: int = base_delay * 2 ** max(0, attempt - 1)
    explicit_cap: int | None = policy.maxAgentDelayMs
    max_delay: int = DEFAULT_MAX_AGENT_RETRY_DELAY_MS if explicit_cap is None else explicit_cap
    return min(delay, max_delay)


async def _sleep(ms: float, signal: AbortSignal | None) -> None:
    """Wait for the backoff, failing with the internal abort marker when cancelled."""

    if signal is not None and signal.aborted:
        raise _RetrySleepAbortError()

    if signal is None:
        await asyncio.sleep(ms / 1000)
        return

    aborted = asyncio.get_running_loop().create_future()

    def on_abort() -> None:
        if not aborted.done():
            aborted.set_result(None)

    signal.add_listener(on_abort, once=True)
    waiting = asyncio.ensure_future(asyncio.sleep(ms / 1000))
    try:
        done, _pending = await asyncio.wait(
            {waiting, aborted},
            return_when=asyncio.FIRST_COMPLETED,
        )
    finally:
        signal.remove_listener(on_abort)

    if aborted in done:
        waiting.cancel()
        raise _RetrySleepAbortError()
    await waiting


async def _call(callback: Callable[..., Awaitable[None] | None] | None, *args: object) -> None:
    """Invoke an optional callback and await it when it returns an awaitable."""

    if callback is None:
        return
    result = callback(*args)
    if result is not None:
        await result


async def retryAssistantCall(
    produce: Callable[[], Awaitable[AssistantMessage]],
    policy: RetryPolicy | None,
    signal: AbortSignal | None,
    callbacks: RetryCallbacks | None = None,
) -> AssistantMessage:
    """Produce an assistant message, retrying transient failures within the policy.

    A successful response returns immediately, and so does a failure the policy will not
    retry. An abort ends the loop without being retried, and an abort that lands during the
    backoff wait is reported as an aborted message rather than raised, so a caller sees the
    same shape wherever cancellation happened.
    """

    max_attempts = policy.maxRetries if policy is not None and policy.enabled else 0
    fired = callbacks if callbacks is not None else RetryCallbacks()

    attempt = 0
    last_retry: tuple[int, str] | None = None
    while True:
        response = await produce()

        if response.stopReason == StopReason.ABORTED:
            if last_retry is not None:
                await _call(fired.onRetryFinished, False, last_retry[0], None)
            return response

        if response.stopReason != StopReason.ERROR:
            if last_retry is not None:
                await _call(fired.onRetryFinished, True, last_retry[0], None)
            return response

        if attempt >= max_attempts or not isRetryableAssistantError(response):
            if last_retry is not None:
                await _call(
                    fired.onRetryFinished,
                    False,
                    last_retry[0],
                    response.errorMessage,
                )
            return response

        attempt += 1
        last_retry = (attempt, response.errorMessage or "Unknown error")
        delay_ms = retryDelayMs(policy, attempt) if policy is not None else 0
        await _call(
            fired.onRetryScheduled,
            attempt,
            max_attempts,
            delay_ms,
            last_retry[1],
        )

        try:
            await _sleep(delay_ms, signal)
        except _RetrySleepAbortError:
            await _call(fired.onRetryFinished, False, attempt, last_retry[1])
            # A provider aborts by returning a message with this shape, so an aborted
            # backoff returns one too. The reference drops the error message here, which a
            # replacement field reproduces.
            return replace(response, stopReason=StopReason.ABORTED, errorMessage=None)
        except BaseException:
            await _call(fired.onRetryFinished, False, attempt, last_retry[1])
            raise
        await _call(fired.onRetryAttemptStart)


def isRetryableAssistantError(message: AssistantMessage) -> bool:
    """Whether a failed assistant message looks like a transient provider or transport error.

    This only classifies. A caller still decides when to restart the turn, and should test
    for context overflow before applying its own retry budget.
    """

    if message.stopReason != StopReason.ERROR or not message.errorMessage:
        return False
    error_message = message.errorMessage
    if _NON_RETRYABLE_PATTERNS.search(error_message):
        return False
    return _RETRYABLE_PATTERNS.search(error_message) is not None
