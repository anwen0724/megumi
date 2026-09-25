"""Exercise persistent Runs through the real Harness and AI runtime."""

from dataclasses import replace

import pytest

from app.agent import AgentHarness
from app.agent.persistence import SQLiteStore
from app.agent.session import Session
from app.ai import CallOptions, Models, TextContent, Usage
from app.ai.api.openai_runtime import OpenAIProtocol


class ReplyAdapter(OpenAIProtocol):
    options_type = CallOptions

    def __init__(self):
        self.requests = []

    async def _produce_simple(self, **call):
        self.requests.append(call["transcript"])
        writer = call["writer"]
        writer.emit({"type": "start", "partial": writer.partial})
        writer.partial.content.append(TextContent(text="Saved answer"))
        writer.partial.usage = Usage(input=3, output=2, total_tokens=5)
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    async def _produce(self, **call):
        await self._produce_simple(**call)


@pytest.mark.asyncio
async def test_reply_and_followup_use_reopened_history(tmp_path, provider, monkeypatch):
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    saved = store.create_session("Conversation")
    adapter = ReplyAdapter()
    models = Models([replace(provider, api=adapter)])
    try:
        session = Session(store, saved.id)
        harness = AgentHarness(models, provider.get_models()[0], session=session)
        first = await harness.prompt("Hello")
        assert first.status == "completed"
        store.close()
        store = SQLiteStore(path)
        session = Session(store, saved.id)
        harness = AgentHarness(models, provider.get_models()[0], session=session)
        snapshot = harness.get_snapshot()
        assert [m.role for m in snapshot.messages] == ["user", "assistant"]
        assert snapshot.operations[0].result == first
        operation = store.get_operation(first.operation_id)
        assert operation.released_at is not None
        assert store.summarize_usage(session_id=saved.id).tokens.total_tokens == 5
        await harness.prompt("Again")
        assert [m.role for m in adapter.requests[1].messages] == ["user", "assistant", "user"]
        assert len(store.list_entries(saved.id)) == 4
    finally:
        await models.aclose()
        store.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", ["intent", "reply"])
async def test_storage_failure_does_not_fake_settlement_or_repeat_request(
    tmp_path,
    provider,
    monkeypatch,
    boundary,
):
    import sqlite3

    from app.agent.persistence.errors import StorageError

    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    saved = store.create_session()
    with sqlite3.connect(path) as conn:
        if boundary == "intent":
            conn.executescript("""
                CREATE TRIGGER fail_write BEFORE UPDATE OF state_json ON operations
                WHEN json_extract(NEW.state_json, '$.at') = 'assistant.effect_pending'
                BEGIN SELECT RAISE(ABORT, 'blocked intent'); END;
            """)
        else:
            conn.executescript("""
                CREATE TRIGGER fail_write BEFORE UPDATE OF state_json ON operations
                WHEN json_extract(NEW.state_json, '$.at') = 'checkpoint'
                BEGIN SELECT RAISE(ABORT, 'blocked reply commit'); END;
            """)
    adapter = ReplyAdapter()
    models = Models([replace(provider, api=adapter)])
    try:
        harness = AgentHarness(models, provider.get_models()[0], session=Session(store, saved.id))
        with pytest.raises(StorageError):
            await harness.prompt("Question")
        assert len(adapter.requests) == (0 if boundary == "intent" else 1)
        store.close()
        store = SQLiteStore(path)
        operation = store.active_operation(saved.id)
        assert operation.result_status is None
        assert operation.released_at is None
        assert [entry.message.role for entry in store.list_entries(saved.id)] == ["user"]
        assert store.list_usage(session_id=saved.id) == []
    finally:
        await models.aclose()
        store.close()
