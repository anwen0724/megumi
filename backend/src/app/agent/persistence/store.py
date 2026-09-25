"""Save and query Agent facts through atomic storage operations."""

import time
from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

from app.agent.persistence.database import Database
from app.agent.persistence.errors import NotFoundError
from app.agent.persistence.records import SessionInfo


class SQLiteStore:
    """Expose validated operations instead of independent per-table commits."""

    def __init__(self, path: str | Path, *, clock: Callable[[], int] | None = None) -> None:
        self._db = Database(path)
        self._clock = clock or (lambda: time.time_ns() // 1_000_000)

    def create_session(self, name: str | None = None) -> SessionInfo:
        """Persist a new session before acknowledging its identity."""
        identity, now = str(uuid4()), self._clock()
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, ?, NULL)", (identity, name, now, now)
            )
            return self.get_session(identity)

    def get_session(self, session_id: str) -> SessionInfo:
        """Read an independent view, reporting absent sessions explicitly."""
        with self._db.transaction(write=False) as conn:
            row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if row is None:
                raise NotFoundError(f"Session not found: {session_id}")
            return SessionInfo(**dict(row))

    def close(self) -> None:
        """Close the host-owned connection, without cancelling any Run."""
        self._db.close()

    def list_sessions(self, *, include_archived: bool = False) -> list[SessionInfo]:
        """List sessions by activity with a stable identity tie-breaker."""
        with self._db.transaction(write=False) as conn:
            rows = conn.execute(
                "SELECT * FROM sessions WHERE (? OR archived_at IS NULL) "
                "ORDER BY last_activity_at DESC, id",
                (include_archived,),
            )
            return [SessionInfo(**dict(row)) for row in rows]

    def rename_session(self, session_id: str, name: str | None) -> SessionInfo:
        """Change the name without manufacturing interaction activity."""
        with self._db.transaction() as conn:
            self.get_session(session_id)
            conn.execute("UPDATE sessions SET name = ? WHERE id = ?", (name, session_id))
            return self.get_session(session_id)

    def archive_session(self, session_id: str) -> SessionInfo:
        """Archive an idle session while preserving its history."""
        with self._db.transaction() as conn:
            self.get_session(session_id)
            conn.execute(
                "UPDATE sessions SET archived_at = COALESCE(archived_at, ?) WHERE id = ?",
                (self._clock(), session_id),
            )
            return self.get_session(session_id)

    def unarchive_session(self, session_id: str) -> SessionInfo:
        """Allow an archived session to accept subsequent work."""
        with self._db.transaction() as conn:
            self.get_session(session_id)
            conn.execute("UPDATE sessions SET archived_at = NULL WHERE id = ?", (session_id,))
            return self.get_session(session_id)

    def delete_session(self, session_id: str) -> None:
        """Physically delete an idle session and its owned facts."""
        with self._db.transaction() as conn:
            self.get_session(session_id)
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
