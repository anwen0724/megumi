"""Observe Agent response cleanup and session admission through public calls."""

from __future__ import annotations

import asyncio

import pytest

from app.agent import AgentHarness, BusyResult, OperationResult, SessionSnapshot
from app.ai import CallOptions, Models, Provider, TextContent


class CleanupAdapter:
    options_type = CallOptions

    def __init__(self, *, failed_generation: bool = False, failed_cleanup: bool = False) -> None:
        self.failed_generation = failed_generation
        self.failed_cleanup = failed_cleanup
        self.calls = 0
        self.cleaning = asyncio.Event()
        self.release = asyncio.Event()
        self.cleaned = 0

    async def stream_simple(self, **call: object) -> None:
        self.calls += 1
        writer = call["writer"]
        writer.add_cleanup(self._cleanup)
        writer.emit({"type": "start", "partial": writer.partial})
        writer.partial.content.append(TextContent(text="Complete answer"))
        if self.failed_generation:
            raise RuntimeError("generation failed")
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    async def _cleanup(self) -> None:
        self.cleaning.set()
        await self.release.wait()
        self.cleaned += 1
        if self.failed_cleanup and self.cleaned == 1:
            raise OSError("resource close failed")

    async def stream(self, **call: object) -> None:
        await self.stream_simple(**call)


@pytest.mark.asyncio
@pytest.mark.parametrize("failed_generation", [False, True])
async def test_result_is_recorded_before_owned_cleanup_completes(
    provider: Provider, monkeypatch: pytest.MonkeyPatch, failed_generation: bool
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = CleanupAdapter(failed_generation=failed_generation)
    models = Models([provider], adapters={provider.api: adapter})
    harness = AgentHarness(models, provider.models[0])
    pending = asyncio.create_task(harness.prompt("Question"))
    try:
        await asyncio.wait_for(adapter.cleaning.wait(), 1)
        result = await asyncio.wait_for(asyncio.shield(pending), 1)
        snapshot = harness.get_snapshot()
        assert snapshot.operations[0].result.status == (
            "failed" if failed_generation else "completed"
        )
        assert result == snapshot.operations[0].result
        assert snapshot.active_operation_id is None
        assert not adapter.release.is_set()
        follow_up = await harness.prompt("Next question")
        assert follow_up.status == result.status
        assert adapter.calls == 2
    finally:
        adapter.release.set()
        await asyncio.gather(pending, return_exceptions=True)
        await models.aclose()


@pytest.mark.asyncio
async def test_cleanup_failure_keeps_generated_result_and_shared_models_usable(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = CleanupAdapter(failed_cleanup=True)
    adapter.release.set()
    models = Models([provider], adapters={provider.api: adapter})
    harness = AgentHarness(models, provider.models[0])
    try:
        first = await harness.prompt("First question")
        assert first.status == "completed"
        recorded = harness.get_snapshot()
        assert recorded.operations[0].result.status == "completed"
        assert recorded.operations[0].result.assistant_message.content == [
            TextContent(text="Complete answer")
        ]
        assert recorded.operations[0].result.assistant_message.diagnostics is None
        assert recorded.active_operation_id is None
        second = await harness.prompt("Second question")
        assert second.status == "completed"
        assert adapter.calls == 2
    finally:
        with pytest.raises(ExceptionGroup, match="Models cleanup failed") as group:
            await models.aclose()
        assert len(group.value.exceptions) == 1
        assert "resource close failed" in str(group.value.exceptions[0])


class HeldGenerationAdapter:
    options_type = CallOptions

    def __init__(self) -> None:
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.calls: list[str] = []

    async def stream_simple(self, **call: object) -> None:
        writer = call["writer"]
        text = call["transcript"].messages[-1].content
        self.calls.append(text)
        if text == "Wait here":
            self.entered.set()
            await self.release.wait()
        writer.emit({"type": "start", "partial": writer.partial})
        writer.partial.content.append(TextContent(text="Answer"))
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    async def stream(self, **call: object) -> None:
        await self.stream_simple(**call)


@pytest.mark.asyncio
async def test_busy_session_rejects_input_while_other_session_can_finish(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = HeldGenerationAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    blocked = AgentHarness(models, provider.models[0])
    separate = AgentHarness(models, provider.models[0])
    running = asyncio.create_task(blocked.prompt("Wait here"))
    try:
        await asyncio.wait_for(adapter.entered.wait(), 1)
        refused = await blocked.prompt("Try twice")
        assert isinstance(refused, BusyResult)
        assert refused.reason == "busy"
        assert [message.content for message in blocked.get_snapshot().messages] == ["Wait here"]
        assert len(blocked.get_snapshot().operations) == 1
        other = await separate.prompt("Separate work")
        assert isinstance(other, OperationResult)
        assert isinstance(separate.get_snapshot(), SessionSnapshot)
        assert other.status == "completed"
        assert [message.content for message in separate.get_snapshot().messages] == [
            "Separate work",
            [TextContent(text="Answer")],
        ]
        assert adapter.calls == ["Wait here", "Separate work"]
        adapter.release.set()
        assert (await asyncio.wait_for(running, 1)).status == "completed"
        accepted = await blocked.prompt("Try twice")
        assert accepted.status == "completed"
        assert adapter.calls == ["Wait here", "Separate work", "Try twice"]
    finally:
        adapter.release.set()
        await asyncio.gather(running, return_exceptions=True)
        await models.aclose()


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_cancel_accepted_agent_work(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = HeldGenerationAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    harness = AgentHarness(models, provider.models[0])
    waiting = asyncio.create_task(harness.prompt("Wait here"))
    try:
        await asyncio.wait_for(adapter.entered.wait(), 1)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        assert (await harness.prompt("Busy input")).reason == "busy"
        assert [message.content for message in harness.get_snapshot().messages] == ["Wait here"]
        adapter.release.set()

        async def wait_for_settlement() -> None:
            while harness.get_snapshot().active_operation_id is not None:
                await asyncio.sleep(0)

        await asyncio.wait_for(wait_for_settlement(), 1)
        snapshot = harness.get_snapshot()
        assert snapshot.operations[0].result.status == "completed"
        assert [message.role for message in snapshot.messages] == ["user", "assistant"]
        again = await harness.prompt("After wait")
        assert again.status == "completed"
        assert adapter.calls == ["Wait here", "After wait"]
    finally:
        adapter.release.set()
        await asyncio.gather(waiting, return_exceptions=True)
        await models.aclose()


@pytest.mark.asyncio
async def test_completed_reply_does_not_wait_for_background_cleanup(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A settled task releases the session while AI finishes its own cleanup."""
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = CleanupAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    harness = AgentHarness(models, provider.models[0])
    running = asyncio.create_task(harness.prompt("First question"))
    try:
        await asyncio.wait_for(adapter.cleaning.wait(), 1)
        outcome = await asyncio.wait_for(asyncio.shield(running), 1)
        assert outcome.status == "completed"
        assert harness.get_snapshot().active_operation_id is None
        assert not adapter.release.is_set()
        follow_up = await asyncio.wait_for(harness.prompt("Next question"), 1)
        assert follow_up.status == "completed"
        assert adapter.calls == 2
    finally:
        adapter.release.set()
        await asyncio.gather(running, return_exceptions=True)
        await models.aclose()
