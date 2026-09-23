"""Observe Agent response cleanup and session admission through public calls."""

from __future__ import annotations

import asyncio

import pytest

from app.agent import AgentHarness
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
        snapshot = harness.get_snapshot()
        assert snapshot.operations[0].result.status == (
            "failed" if failed_generation else "completed"
        )
        assert snapshot.active_operation_id == snapshot.operations[0].operation_id
        assert not pending.done()
        adapter.release.set()
        result = await asyncio.wait_for(pending, 1)
        assert result == snapshot.operations[0].result
        assert harness.get_snapshot().active_operation_id is None
        assert adapter.cleaned == 1
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
        with pytest.raises(ExceptionGroup, match="Response cleanup failed"):
            await harness.prompt("First question")
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
        assert adapter.cleaned == 2
    finally:
        with pytest.raises(ExceptionGroup, match="Models cleanup failed") as group:
            await models.aclose()
        assert len(group.value.exceptions) == 1
        assert "resource close failed" in str(group.value.exceptions[0])
