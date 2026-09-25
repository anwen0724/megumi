"""Verify initialization and migration safety with real SQLite files."""

import sqlite3

import pytest

from app.agent.persistence import SQLiteStore
from app.agent.persistence.database import Database
from app.agent.persistence.errors import StorageError


def test_unknown_version_is_refused_without_rebuilding(tmp_path):
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    saved = store.create_session("Keep")
    store.close()
    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA user_version = 99")
    with pytest.raises(StorageError, match="version"):
        SQLiteStore(path)
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT name FROM sessions WHERE id = ?", (saved.id,)).fetchone() == (
            "Keep",
        )


def test_migration_failure_rolls_back_schema_and_version(tmp_path, monkeypatch):
    # Supply a failing migration resource, not a fake connection or transaction.
    package = tmp_path / "package"
    migrations = package / "migrations"
    migrations.mkdir(parents=True)
    (migrations / "001-initial.sql").write_text(
        "CREATE TABLE partial (id TEXT); INSERT INTO absent VALUES (1);"
    )
    monkeypatch.setattr("app.agent.persistence.database.files", lambda _: package)
    path = tmp_path / "failed.sqlite3"
    with pytest.raises(StorageError, match="migration"):
        Database(path)
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 0
        assert (
            conn.execute("SELECT name FROM sqlite_master WHERE name='partial'").fetchone() is None
        )
