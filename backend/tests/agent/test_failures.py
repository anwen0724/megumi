"""Exercise failed Agent operations through the real AI response lifecycle."""

from __future__ import annotations

import pytest

from app.agent import AgentHarness
from app.ai import CallOptions, Models, Provider, TextContent


class FailThenSucceedAdapter:
    options_type = CallOptions

    def __init__(self, partial: bool) -> None:
        self.partial = partial
        self.calls = 0
        self.requests: list[object] = []

    async def stream_simple(self, **call: object) -> None:
        self.calls += 1
        self.requests.append(call["transcript"])
        writer = call["writer"]
        if self.calls == 1:
            writer.emit({"type": "start", "partial": writer.partial})
            if self.partial:
                writer.partial.content.append(TextContent(text="Partial reply"))
                writer.emit(
                    {
                        "type": "text_delta",
                        "content_index": 0,
                        "delta": "Partial reply",
                        "partial": writer.partial,
                    }
                )
            raise RuntimeError("supplier stream failed")
        writer.emit({"type": "start", "partial": writer.partial})
        writer.partial.content.append(TextContent(text="Recovered on new input"))
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    async def stream(self, **call: object) -> None:
        await self.stream_simple(**call)


@pytest.mark.asyncio
@pytest.mark.parametrize("partial", [False, True])
async def test_failed_generation_retains_evidence_and_frees_session(
    provider: Provider, monkeypatch: pytest.MonkeyPatch, partial: bool
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = FailThenSucceedAdapter(partial)
    models = Models([provider], adapters={provider.api: adapter})
    harness = AgentHarness(models, provider.models[0])
    try:
        failed = await harness.prompt("First input")
        snapshot = harness.get_snapshot()
        assert failed.status == "failed"
        assert failed.assistant_message.stop_reason == "error"
        assert "supplier stream failed" in failed.error_message
        assert [block.text for block in failed.assistant_message.content] == (
            ["Partial reply"] if partial else []
        )
        assert snapshot.operations[0].result == failed
        assert snapshot.messages[0].content == "First input"
        assert snapshot.messages[1] == failed.assistant_message
        assert snapshot.active_operation_id is None
        assert adapter.calls == 1
        follow_up = await harness.prompt("Second input")
        assert follow_up.status == "completed"
        assert adapter.calls == 2
        assert [message.role for message in adapter.requests[1].messages] == ["user", "user"]
    finally:
        await models.aclose()


@pytest.mark.asyncio
async def test_call_setup_failure_has_no_invented_assistant_message(provider: Provider) -> None:
    models = Models([provider])
    await models.aclose()
    harness = AgentHarness(models, provider.models[0])
    first = await harness.prompt("First input")
    second = await harness.prompt("Second input")
    snapshot = harness.get_snapshot()
    assert first.status == second.status == "failed"
    assert first.assistant_message is None
    assert second.assistant_message is None
    assert "closed" in first.error_message
    assert [message.role for message in snapshot.messages] == ["user", "user"]
    assert len(snapshot.operations) == 2
    assert snapshot.active_operation_id is None
