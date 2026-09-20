"""Wrapping a protocol implementation so it loads only when a request needs it.

Model catalogues are large and a protocol module pulls in its protocol's parsing, so a
caller that only wants the message types should not pay for either. The wrapper keeps the
stream contract synchronous — a caller gets a stream immediately — while the import, the
auth resolution and the connection all happen behind it.

A failure in any of that becomes an error event on the stream rather than a raise, because
the caller already holds the stream by the time it happens.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from app.ai.models import ProviderStreams
from app.ai.types import (
    AssistantMessage,
    AssistantMessageEvent,
    EventError,
    Model,
    SimpleStreamOptions,
    StopReason,
    StreamOptions,
    TranscriptContext,
    Usage,
    UsageCost,
)
from app.ai.utils.event_stream import AssistantMessageEventStream

__all__ = ["lazyApi", "lazyStream"]


def _setup_error_message(model: Model, error: BaseException) -> AssistantMessage:
    """The terminal message a failed setup produces."""

    return AssistantMessage(
        content=[],
        api=model.api,
        provider=model.provider,
        model=model.id,
        usage=Usage(
            input=0,
            output=0,
            cacheRead=0,
            cacheWrite=0,
            totalTokens=0,
            cost=UsageCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0, total=0.0),
        ),
        stopReason=StopReason.ERROR,
        errorMessage=str(error),
        timestamp=0,
    )


# Keeps references to the forwarding tasks so none is collected before it finishes.
_RUNNERS: set[Any] = set()


def lazyStream(
    model: Model,
    setup: Callable[[], Awaitable[AssistantMessageEventStream]],
) -> AssistantMessageEventStream:
    """Return a stream synchronously while running ``setup`` behind it."""

    outer = AssistantMessageEventStream()

    async def forward() -> None:
        try:
            inner = await setup()
        except BaseException as error:
            message = _setup_error_message(model, error)
            outer.push(EventError(reason="error", error=message))
            outer.end(message)
            return
        async for event in inner:
            outer.push(event)
        outer.end(await inner.result())

    runner = asyncio.ensure_future(forward())
    _RUNNERS.add(runner)
    runner.add_done_callback(_RUNNERS.discard)
    return outer


def lazyApi(
    load: Callable[[], Awaitable[ProviderStreams]],
    capabilities: dict[str, bool] | None = None,
) -> ProviderStreams:
    """Wrap a protocol module so it is imported on the first stream call.

    ``capabilities`` declares which deferred-response methods the module provides, so a
    provider can advertise them without importing the module to find out.
    """

    async def resolve() -> ProviderStreams:
        return await load()

    def stream(
        model: Model,
        context: TranscriptContext,
        options: StreamOptions | None,
    ) -> AssistantMessageEventStream:
        async def setup() -> AssistantMessageEventStream:
            return (await resolve()).stream(model, context, options)

        return lazyStream(model, setup)

    def stream_simple(
        model: Model,
        context: TranscriptContext,
        options: SimpleStreamOptions | None,
    ) -> AssistantMessageEventStream:
        async def setup() -> AssistantMessageEventStream:
            return (await resolve()).streamSimple(model, context, options)

        return lazyStream(model, setup)

    streams = ProviderStreams(stream=stream, streamSimple=stream_simple)

    if capabilities and capabilities.get("fetchDeferred"):
        def fetch_deferred(
            model: Model,
            handle: Any,
            options: Any = None,
        ) -> AssistantMessageEventStream:
            async def setup() -> AssistantMessageEventStream:
                implementation = await resolve()
                if implementation.fetchDeferred is None:
                    raise RuntimeError("API does not support deferred responses")
                return implementation.fetchDeferred(model, handle, options)

            return lazyStream(model, setup)

        streams.fetchDeferred = fetch_deferred

    if capabilities and capabilities.get("cancelDeferred"):
        async def cancel_deferred(model: Model, handle: Any, options: Any = None) -> None:
            implementation = await resolve()
            if implementation.cancelDeferred is None:
                raise RuntimeError("API cannot cancel deferred responses")
            await implementation.cancelDeferred(model, handle, options)

        streams.cancelDeferred = cancel_deferred

    return streams


def _unused_event_hint(event: AssistantMessageEvent) -> AssistantMessageEvent:
    """Keeps the event type referenced for readers of the forwarding loop above."""

    return event
