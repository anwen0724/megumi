"""Verify one short Agent answer with a real registered supplier model."""

import pytest

from app.agent import AgentHarness, OperationResult
from app.ai import Models, Provider, TextContent
from app.ai.model import Model

pytestmark = [pytest.mark.asyncio, pytest.mark.live]


async def test_real_short_reply(live_provider_and_model: tuple[Provider, Model]) -> None:
    provider, model = live_provider_and_model
    models = Models([provider])
    try:
        harness = AgentHarness(models, model)
        outcome = await harness.prompt("Reply with one short greeting in English.")
        assert isinstance(outcome, OperationResult)
        assert outcome.status == "completed", outcome.error_message
        assert outcome.assistant_message is not None
        assert any(
            isinstance(block, TextContent) and block.text.strip()
            for block in outcome.assistant_message.content
        )
        snapshot = harness.get_snapshot()
        assert [message.role for message in snapshot.messages] == ["user", "assistant"]
        assert snapshot.operations[0].result == outcome
    finally:
        await models.aclose()
