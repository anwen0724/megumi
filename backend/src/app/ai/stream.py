"""Own background generation independently of event and final-result consumers."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from copy import deepcopy

from app.ai.events import AssistantMessageEvent
from app.ai.messages import AssistantMessage
from app.ai.model import Model
from app.ai.runtime.diagnostics import append_cleanup_diagnostic, format_error, redact_text
from app.ai.runtime.retry import SignalAborted


class ResponseWriter:
    """Protocol-facing producer handle; terminal selection precedes resource cleanup."""

    def __init__(self, model: Model, emit: Callable[[AssistantMessageEvent], None]) -> None:
        self.partial = AssistantMessage(
            content=[],
            provider=model.provider,
            api=model.api,
            model=model.id,
            timestamp=time.time_ns() // 1_000_000,
        )
        self._emit = emit
        self._final: AssistantMessage | None = None
        self._sensitive_values: set[str] = set()
        self._cleanups: list[Callable[[], Awaitable[None]]] = []

    def emit(self, event: AssistantMessageEvent) -> None:
        """Publish progress, or select one independent terminal snapshot for later publication."""
        if self._final is not None:
            return
        if event["type"] in {"done", "error"}:
            self._final = deepcopy(event["message"] if event["type"] == "done" else event["error"])
            self._final.stop_reason = event["reason"]
        else:
            self._emit(event)

    def add_cleanup(self, cleanup: Callable[[], Awaitable[None]]) -> None:
        """Register each acquired resource immediately; cleanup executes in reverse order."""
        self._cleanups.append(cleanup)

    def protect(self, values: Iterable[str]) -> None:
        """Register known credentials for exception and cleanup diagnostic redaction."""
        self._sensitive_values.update(value for value in values if value)

    def fail(self, reason: str, *, aborted: bool = False) -> None:
        """Select a failure only if the protocol has not already chosen a terminal result."""
        if self._final is not None:
            return
        self.partial.stop_reason = "aborted" if aborted else "error"
        self.partial.error_message = reason
        self._final = deepcopy(self.partial)


class AssistantResponse:
    """Start production immediately; result waits do not own or cancel shared generation."""

    def __init__(
        self,
        model: Model,
        produce: Callable[[ResponseWriter], Awaitable[None]],
        *,
        signal: asyncio.Event | None = None,
    ) -> None:
        self._queue: asyncio.Queue[AssistantMessageEvent | None] = asyncio.Queue()
        self._result: asyncio.Future[AssistantMessage] = asyncio.get_running_loop().create_future()
        self._writer = ResponseWriter(model, self._queue.put_nowait)
        self._started = False
        self._finalizing = False
        self._cancel_requested = bool(signal and signal.is_set())
        self._task = asyncio.create_task(self._run(produce))
        self._signal_task = (
            asyncio.create_task(self._watch_signal(signal)) if signal is not None else None
        )

    @property
    def partial(self) -> AssistantMessage:
        """The producer's mutable message; use frames to retain progress snapshots."""
        return self._writer.partial

    def cancel(self) -> None:
        """Cancel owned generation, never an already selected terminal result."""
        if (
            self._cancel_requested
            or self._finalizing
            or self._writer._final is not None
            or self._task.done()
        ):
            return
        self._cancel_requested = True
        # A task cancelled before its first step never enters its finally block.
        if self._started:
            self._task.cancel()

    async def _watch_signal(self, signal: asyncio.Event) -> None:
        await signal.wait()
        self.cancel()

    async def aclose(self) -> None:
        """Stop active generation and wait for cleanup; repeated calls are harmless."""
        self.cancel()
        await asyncio.shield(self._task)

    async def _run(self, produce: Callable[[ResponseWriter], Awaitable[None]]) -> None:
        self._started = True
        try:
            if self._cancel_requested:
                raise SignalAborted("Request aborted")
            await produce(self._writer)
            if self._writer._final is None:
                self._writer.fail("Stream ended without a terminal result")
        except (asyncio.CancelledError, SignalAborted):
            self._writer.fail("Request aborted", aborted=True)
        except Exception as error:
            self._writer.fail(format_error(error, sensitive_values=self._writer._sensitive_values))
        finally:
            self._finalizing = True
            if self._signal_task is not None:
                self._signal_task.cancel()
                await asyncio.gather(self._signal_task, return_exceptions=True)
            final = self._writer._final
            if final is not None:
                if final.error_message is not None:
                    final.error_message = redact_text(
                        final.error_message, self._writer._sensitive_values
                    )
                for cleanup in reversed(self._writer._cleanups):
                    try:
                        await cleanup()
                    except (Exception, asyncio.CancelledError) as error:
                        append_cleanup_diagnostic(
                            final, error, sensitive_values=self._writer._sensitive_values
                        )
                if final.stop_reason in {"stop", "length", "tool_use"}:
                    self._queue.put_nowait(
                        {"type": "done", "reason": final.stop_reason, "message": final}
                    )
                else:
                    self._queue.put_nowait(
                        {
                            "type": "error",
                            "reason": "aborted" if final.stop_reason == "aborted" else "error",
                            "error": final,
                        }
                    )
                self._result.set_result(final)
            self._queue.put_nowait(None)

    async def result(self) -> AssistantMessage:
        """Await the cached cleaned result without exposing its Future to waiter cancellation."""
        return await asyncio.shield(self._result)

    async def __aiter__(self) -> AsyncIterator[AssistantMessageEvent]:
        """Consume one shared queue; cancelling a waiter leaves generation and events intact."""
        while True:
            event = await self._queue.get()
            if event is None:
                self._queue.put_nowait(None)
                return
            yield event
