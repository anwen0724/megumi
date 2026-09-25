"""Own SQLite connections, transactional migrations and short atomic commits."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from importlib.resources import files
from pathlib import Path
from threading import RLock

from app.agent.persistence.errors import ConflictError, StorageError


class Database:
    """Keep every connection under foreign-key and transaction control."""

    def __init__(self, path: str | Path) -> None:
        self._lock = RLock()
        self._depth = 0
        try:
            self.connection = sqlite3.connect(str(path), isolation_level=None)
            self.connection.row_factory = sqlite3.Row
            self.connection.execute("PRAGMA foreign_keys = ON")
            self._migrate()
        except Exception:
            if hasattr(self, "connection"):
                self.connection.close()
            raise

    def _migrate(self) -> None:
        """Apply only unapplied versions, preserving existing user data."""
        version = self.connection.execute("PRAGMA user_version").fetchone()[0]
        scripts = sorted(files(__package__).joinpath("migrations").iterdir(), key=lambda p: p.name)
        scripts = [p for p in scripts if p.name.endswith(".sql")]
        if version > len(scripts):
            raise StorageError(f"Unsupported database version: {version}")
        for index, script in enumerate(scripts, 1):
            if index <= version:
                continue
            try:
                self.connection.executescript(
                    "BEGIN IMMEDIATE;\n"
                    + script.read_text(encoding="utf-8")
                    + f"\nPRAGMA user_version = {index};\nCOMMIT;"
                )
            except sqlite3.Error as error:
                if self.connection.in_transaction:
                    self.connection.rollback()
                raise StorageError("Database migration failed") from error

    @contextmanager
    def transaction(self, *, write: bool = True) -> Iterator[sqlite3.Connection]:
        """Commit a whole operation; nested calls share its atomic outcome."""
        with self._lock:
            depth = self._depth
            savepoint = f"nested_{depth}"
            try:
                self.connection.execute(
                    f"SAVEPOINT {savepoint}" if depth else ("BEGIN IMMEDIATE" if write else "BEGIN")
                )
                self._depth += 1
                try:
                    yield self.connection
                    self.connection.execute(f"RELEASE SAVEPOINT {savepoint}" if depth else "COMMIT")
                except BaseException:
                    if depth:
                        self.connection.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                        self.connection.execute(f"RELEASE SAVEPOINT {savepoint}")
                    elif self.connection.in_transaction:
                        self.connection.rollback()
                    raise
                finally:
                    self._depth -= 1
            except sqlite3.IntegrityError as error:
                raise ConflictError(str(error)) from error
            except sqlite3.Error as error:
                raise StorageError(str(error)) from error

    def close(self) -> None:
        """Close this connection after the host has finished using it."""
        self.connection.close()
