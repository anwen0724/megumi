"""Exercise session management through the real SQLite store."""

from app.agent.persistence import SQLiteStore


def test_created_session_survives_reopening(tmp_path):
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session("Research")
    store.close()
    reopened = SQLiteStore(path)
    try:
        saved = reopened.get_session(session.id)
        assert saved == session
        assert saved.name == "Research"
        assert saved.archived_at is None
        assert saved.created_at == saved.last_activity_at
    finally:
        reopened.close()


def test_management_keeps_activity_and_archive_controls_listing(tmp_path):
    now = [100]
    store = SQLiteStore(tmp_path / "agent.sqlite3", clock=lambda: now[0])
    first = store.create_session()
    now[0] = 200
    second = store.create_session("Second")
    now[0] = 300
    store.rename_session(first.id, "Renamed")
    store.archive_session(second.id)
    assert [s.id for s in store.list_sessions()] == [first.id]
    assert [s.id for s in store.list_sessions(include_archived=True)] == [second.id, first.id]
    assert store.get_session(first.id).last_activity_at == 100
    assert store.get_session(second.id).archived_at == 300
    store.unarchive_session(second.id)
    assert store.list_sessions()[0].id == second.id
    assert store.get_session(second.id).last_activity_at == 200
    store.delete_session(first.id)
    import pytest

    from app.agent.persistence.errors import NotFoundError

    with pytest.raises(NotFoundError):
        store.get_session(first.id)
    store.close()


def test_only_conversation_messages_refresh_activity(tmp_path):
    from app.ai import SystemMessage, UserMessage

    now = [100]
    store = SQLiteStore(tmp_path / "agent.sqlite3", clock=lambda: now[0])
    session = store.create_session()
    now[0] = 200
    store.append_message(session.id, SystemMessage(content="Rules", timestamp=1))
    store.append_custom(session.id, "note", {"text": "internal"})
    store.enqueue_input(session.id, "next_run", UserMessage(content="Later", timestamp=1))
    assert store.get_session(session.id).last_activity_at == 100
    now[0] = 300
    store.append_message(session.id, UserMessage(content="Hello", timestamp=2))
    assert store.get_session(session.id).last_activity_at == 300
    store.close()
