"""Verify public Agent conversation behavior through the real AI call runtime."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest

from app.agent import AgentHarness
from app.ai import (
    AssistantMessageDiagnostic,
    CallOptions,
    Models,
    Provider,
    TextContent,
    ThinkingContent,
    Usage,
    UsageCost,
    get_current_system_prompt,
)
from app.ai.api.openai_runtime import OpenAIProtocol


class TextAdapter(OpenAIProtocol):
    options_type = CallOptions

    def __init__(self) -> None:
        self.requests: list[dict[str, object]] = []
        self.cleaned = False

    async def _produce_simple(self, **call: object) -> None:
        self.requests.append(call)
        writer = call["writer"]
        writer.emit({"type": "start", "partial": writer.partial})
        writer.partial.content.append(TextContent(text="Hello!"))
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})
        writer.add_cleanup(self._cleanup)

    async def _cleanup(self) -> None:
        self.cleaned = True

    async def _produce(self, **call: object) -> None:
        await self._produce_simple(**call)


@pytest.mark.asyncio
async def test_basic_reply_records_one_user_and_one_complete_assistant(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = TextAdapter()
    models = Models([replace(provider, api=adapter)])
    model = provider.get_models()[0]
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
        assert len(adapter.requests) == 1
        request = adapter.requests[0]
        assert request["model"] == replace(model, base_url=provider.base_url)
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
    models = Models([replace(provider, api=adapter)])
    first = AgentHarness(models, provider.get_models()[0], system_prompt="Reply briefly")
    second = AgentHarness(models, provider.get_models()[0], system_prompt="Other session")
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
            "user",
            "assistant",
            "user",
            "assistant",
        ]
        assert len(first.get_snapshot().operations) == 2
        assert len(second.get_snapshot().operations) == 1
        assert first.get_snapshot().session_id != second.get_snapshot().session_id
    finally:
        await models.aclose()


class RichAdapter(TextAdapter):
    def __init__(self, reason: str) -> None:
        super().__init__()
        self.reason = reason

    async def _produce_simple(self, **call: object) -> None:
        self.requests.append(call)
        writer = call["writer"]
        writer.emit({"type": "start", "partial": writer.partial})
        writer.partial.content.append(TextContent(text="Part one"))
        writer.emit({"type": "text_start", "content_index": 0, "partial": writer.partial})
        writer.emit(
            {
                "type": "text_delta",
                "content_index": 0,
                "delta": "Part one",
                "partial": writer.partial,
            }
        )
        writer.partial.content[0].text += " and two"
        writer.emit(
            {
                "type": "text_delta",
                "content_index": 0,
                "delta": " and two",
                "partial": writer.partial,
            }
        )
        writer.partial.content[0].text_signature = "signed-text"
        writer.partial.content.append(
            ThinkingContent(thinking="Reason", thinking_signature="signed-thinking")
        )
        writer.partial.response_id = "response-7"
        writer.partial.response_model = "resolved-model"
        writer.partial.diagnostics = [AssistantMessageDiagnostic(type="provider_note", timestamp=1)]
        writer.partial.usage = Usage(input=12, output=9, cost=UsageCost(total=Decimal("0.02")))
        writer.emit({"type": "done", "reason": self.reason, "message": writer.partial})
        writer.add_cleanup(self._cleanup)


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["stop", "length"])
async def test_final_message_preserves_metadata_and_length_without_extra_request(
    provider: Provider, monkeypatch: pytest.MonkeyPatch, reason: str
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = RichAdapter(reason)
    models = Models([replace(provider, api=adapter)])
    harness = AgentHarness(models, provider.get_models()[0])
    try:
        result = await harness.prompt("Explain briefly")
        snapshot = harness.get_snapshot()
        message = result.assistant_message
        assert result.status == "completed"
        assert message.stop_reason == reason
        assert message.provider == "sample"
        assert message.response_id == "response-7"
        assert message.response_model == "resolved-model"
        assert message.content == [
            TextContent(text="Part one and two", text_signature="signed-text"),
            ThinkingContent(thinking="Reason", thinking_signature="signed-thinking"),
        ]
        assert message.diagnostics == [
            AssistantMessageDiagnostic(type="provider_note", timestamp=1)
        ]
        assert message.usage.input == 12
        assert message.usage.output == 9
        assert message.usage.cache_read is None
        assert message.usage.cost.total == Decimal("0.02")
        assert message.usage.cost.input is None
        assert snapshot.messages == [snapshot.messages[0], message]
        assert snapshot.operations[0].result.assistant_message == message
        assert len(adapter.requests) == 1
    finally:
        await models.aclose()
