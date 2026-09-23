"""Verify public Agent conversation behavior through the real AI call runtime."""

from __future__ import annotations

import pytest

from app.agent import AgentHarness
from app.ai import CallOptions, Models, Provider, TextContent, get_current_system_prompt


class TextAdapter:
    options_type = CallOptions

    def __init__(self) -> None:
        self.requests: list[dict[str, object]] = []
        self.cleaned = False

    async def stream_simple(self, **call: object) -> None:
        self.requests.append(call)
        writer = call["writer"]
        writer.emit({"type": "start", "partial": writer.partial})
        writer.partial.content.append(TextContent(text="Hello!"))
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})
        writer.add_cleanup(self._cleanup)

    async def _cleanup(self) -> None:
        self.cleaned = True

    async def stream(self, **call: object) -> None:
        await self.stream_simple(**call)


@pytest.mark.asyncio
async def test_basic_reply_records_one_user_and_one_complete_assistant(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = TextAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    model = provider.models[0]
    harness = AgentHarness(models, model, system_prompt="Reply briefly")
    try:
        result = await harness.prompt("Hello")
        snapshot = harness.get_snapshot()
        assert result.status == "completed"
        assert result.assistant_message.content == [TextContent(text="Hello!")]
        assert [message.role for message in snapshot.messages] == ["user", "assistant"]
        assert snapshot.messages[0].content == "Hello"
        assert snapshot.messages[1] == result.assistant_message
        assert len(snapshot.operations) == 1
        assert snapshot.operations[0].result == result
        assert snapshot.active_operation_id is None
        assert adapter.cleaned
        assert len(adapter.requests) == 1
        request = adapter.requests[0]
        assert request["model"] == model
        transcript = request["transcript"]
        assert get_current_system_prompt(transcript.messages) == "Reply briefly"
        assert [message.role for message in transcript.messages] == ["system", "user"]
    finally:
        await models.aclose()

@pytest.mark.asyncio
async def test_follow_up_uses_prior_messages_without_leaking_another_session(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = TextAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    first = AgentHarness(models, provider.models[0], system_prompt="Reply briefly")
    second = AgentHarness(models, provider.models[0], system_prompt="Other session")
    try:
        await first.prompt("My name is Ming")
        old_view = first.get_snapshot()
        old_view.messages[1].content[0].text = "changed outside"
        await first.prompt("What is my name?")
        await second.prompt("Independent question")
        first_history = adapter.requests[1]["transcript"].messages
        second_history = adapter.requests[2]["transcript"].messages
        assert [message.content for message in first_history[1:]] == [
            "My name is Ming",
            [TextContent(text="Hello!")],
            "What is my name?",
        ]
        assert get_current_system_prompt(first_history) == "Reply briefly"
        assert [message.content for message in second_history[1:]] == ["Independent question"]
        assert get_current_system_prompt(second_history) == "Other session"
        assert [message.role for message in first.get_snapshot().messages] == [
            "user", "assistant", "user", "assistant"
        ]
        assert len(first.get_snapshot().operations) == 2
        assert len(second.get_snapshot().operations) == 1
        assert first.get_snapshot().session_id != second.get_snapshot().session_id
    finally:
        await models.aclose()
