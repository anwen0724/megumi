"""Save and query Agent facts through atomic storage operations."""

import sqlite3
import time
from collections.abc import Callable, Sequence
from decimal import Decimal, localcontext
from pathlib import Path
from typing import Literal, cast
from uuid import uuid4

from app.agent.persistence.codec import (
    decode_message,
    decode_state,
    decode_usage,
    encode_message,
    encode_state,
    encode_usage,
    identity,
    json_decode,
    json_encode,
)
from app.agent.persistence.database import Database
from app.agent.persistence.errors import (
    ArchivedError,
    BusyError,
    ConflictError,
    InvalidRecordError,
    NotFoundError,
    StaleWriteError,
)
from app.agent.persistence.operation_state import OperationSettings, OperationState, StartingState
from app.agent.persistence.records import (
    HistoryEntry,
    OperationInfo,
    ResultStatus,
    SessionInfo,
    UsageEntry,
    UsageSummary,
)
from app.ai import JSONValue, Message, Usage, UsageCost


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
            self._require_idle(session_id)
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
            self._require_idle(session_id)
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))

    def _require_idle(self, session_id: str) -> SessionInfo:
        """Check session ownership inside the caller's write transaction."""
        session = self.get_session(session_id)
        if self.active_operation(session_id) is not None:
            raise BusyError("Session has an unreleased operation")
        return session

    def active_operation(self, session_id: str) -> OperationInfo | None:
        """Read the operation that still owns this session."""
        with self._db.transaction(write=False) as conn:
            self.get_session(session_id)
            row = conn.execute(
                "SELECT id FROM operations WHERE session_id = ? AND released_at IS NULL",
                (session_id,),
            ).fetchone()
            return self.get_operation(row["id"]) if row else None

    def get_operation(self, operation_id: str) -> OperationInfo:
        """Read saved state or result without starting a recovery driver."""
        with self._db.transaction(write=False) as conn:
            row = conn.execute("SELECT * FROM operations WHERE id = ?", (operation_id,)).fetchone()
            if row is None:
                raise NotFoundError(f"Operation not found: {operation_id}")
            data = dict(row)
            data["intent"] = json_decode(data.pop("intent_json")) if row["intent_json"] else None
            data["state"] = decode_state(data.pop("state_json")) if row["state_json"] else None
            data["error"] = json_decode(data.pop("error_json")) if row["error_json"] else None
            # pop also when NULL; all three SQL columns map to typed public fields.
            for column in ("intent_json", "state_json", "error_json"):
                data.pop(column, None)
            return OperationInfo(**data)

    def list_operations(self, session_id: str) -> list[OperationInfo]:
        """Read operation history in stable acceptance order."""
        with self._db.transaction(write=False) as conn:
            self.get_session(session_id)
            ids = conn.execute(
                "SELECT id FROM operations WHERE session_id = ? ORDER BY accepted_at, rowid",
                (session_id,),
            ).fetchall()
            return [self.get_operation(row["id"]) for row in ids]

    def list_entries(self, session_id: str) -> list[HistoryEntry]:
        """Return full ordered history, preserving original source identities."""
        with self._db.transaction(write=False) as conn:
            self.get_session(session_id)
            return [
                self._entry(row)
                for row in conn.execute(
                    "SELECT * FROM session_entries WHERE session_id = ? ORDER BY seq",
                    (session_id,),
                )
            ]

    @staticmethod
    def _entry(row: sqlite3.Row) -> HistoryEntry:
        """Decode one persisted entry and its complete AI message when present."""
        payload = json_decode(row["payload_json"])
        if not isinstance(payload, dict):
            raise InvalidRecordError("History payload must be an object")
        return HistoryEntry(
            row["id"],
            row["session_id"],
            row["operation_id"],
            row["seq"],
            row["type"],
            payload,
            row["recorded_at"],
            decode_message(row["payload_json"]) if row["type"] == "message" else None,
        )

    def get_entry(self, entry_id: str) -> HistoryEntry:
        """Read a formal history identity; future reserved identities are absent."""
        with self._db.transaction(write=False) as conn:
            row = conn.execute("SELECT * FROM session_entries WHERE id = ?", (entry_id,)).fetchone()
            if row is None:
                raise NotFoundError(f"History entry not found: {entry_id}")
            return self._entry(row)

    def _tip(self, session_id: str | None) -> str | None:
        row = self._db.connection.execute(
            "SELECT id FROM session_entries WHERE session_id = ? ORDER BY seq DESC LIMIT 1",
            (session_id,),
        ).fetchone()
        return row["id"] if row else None

    def _insert_message(
        self,
        session_id: str,
        message: Message,
        *,
        entry_id: str,
        operation_id: str | None = None,
        terminate: bool = False,
    ) -> HistoryEntry:
        """Append once within the surrounding transaction, before exposing activity."""
        payload = cast(dict[str, JSONValue], json_decode(encode_message(message)))
        if terminate:
            payload["terminate"] = True
        return self._insert_entry(
            session_id,
            entry_id,
            "message",
            payload,
            operation_id=operation_id,
        )

    def _insert_entry(
        self,
        session_id: str,
        entry_id: str,
        entry_type: Literal["message", "custom", "compaction"],
        payload: dict[str, JSONValue],
        *,
        operation_id: str | None = None,
    ) -> HistoryEntry:
        identity(entry_id)
        self.get_session(session_id)
        if operation_id is not None and self.get_operation(operation_id).session_id != session_id:
            raise InvalidRecordError("History and operation must belong to the same session")
        encoded = json_encode(payload)
        conn = self._db.connection
        existing = conn.execute(
            "SELECT * FROM session_entries WHERE id = ?", (entry_id,)
        ).fetchone()
        if existing:
            if (
                existing["session_id"],
                existing["operation_id"],
                existing["type"],
                json_decode(existing["payload_json"]),
            ) != (session_id, operation_id, entry_type, payload):
                raise ConflictError("History identity already contains a different fact")
            return self._entry(existing)
        seq = conn.execute(
            "SELECT COALESCE(MAX(seq), -1) + 1 FROM session_entries WHERE session_id = ?",
            (session_id,),
        ).fetchone()[0]
        now = self._clock()
        conn.execute(
            "INSERT INTO session_entries VALUES (?, ?, ?, ?, ?, ?, ?)",
            (entry_id, session_id, operation_id, seq, entry_type, encoded, now),
        )
        if entry_type == "message":
            conn.execute("UPDATE sessions SET last_activity_at = ? WHERE id = ?", (now, session_id))
        return self.get_entry(entry_id)

    def append_message(
        self,
        session_id: str,
        message: Message,
        *,
        entry_id: str | None = None,
    ) -> str:
        """Append a complete message to an idle session without starting a Run."""
        with self._db.transaction():
            self._require_idle(session_id)
            return self._insert_message(session_id, message, entry_id=entry_id or str(uuid4())).id

    def accept_operation(
        self,
        session_id: str,
        messages: Sequence[Message],
        *,
        kind: Literal["run", "compaction"] = "run",
        settings: OperationSettings | None = None,
        operation_id: str | None = None,
    ) -> OperationInfo:
        """Atomically claim a session, save direct inputs and establish initial state."""
        operation_id = identity(operation_id or str(uuid4()))
        with self._db.transaction() as conn:
            session = self._require_idle(session_id)
            if session.archived_at is not None:
                raise ArchivedError("Session is archived")
            state = StartingState(settings=settings or OperationSettings())
            conn.execute(
                "INSERT INTO operations(id, session_id, kind, intent_json, state_json, "
                "base_entry_id, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    operation_id,
                    session_id,
                    kind,
                    "{}",
                    encode_state(state),
                    self._tip(session_id),
                    self._clock(),
                ),
            )
            prompt_ids: list[JSONValue] = [
                self._insert_message(
                    session_id, message, entry_id=str(uuid4()), operation_id=operation_id
                ).id
                for message in messages
            ]
            intent = {"prompt_entry_ids": prompt_ids} if kind == "run" else {}
            conn.execute(
                "UPDATE operations SET intent_json = ? WHERE id = ?",
                (json_encode(intent), operation_id),
            )
            return self.get_operation(operation_id)

    def _expect(self, operation_id: str, expected: OperationState | None) -> OperationInfo:
        """Compare the complete saved phase, including request identity, inside the transaction."""
        operation = self.get_operation(operation_id)
        if operation.state is None or expected is None or operation.state != expected:
            raise StaleWriteError("Operation no longer matches expected state")
        return operation

    def finish_operation(
        self,
        operation_id: str,
        *,
        expected: OperationState | None,
        status: ResultStatus,
        error: dict[str, JSONValue] | None = None,
    ) -> OperationInfo:
        """Persist a terminal result separately from releasing execution ownership."""
        if status not in ("completed", "declined", "aborted", "failed"):
            raise InvalidRecordError("Invalid operation result")
        if (status == "failed") != (error is not None):
            raise InvalidRecordError("Only failed results require an error")
        if error is not None and not (
            isinstance(error.get("code"), str) and isinstance(error.get("message"), str)
        ):
            raise InvalidRecordError("Error requires code and message")
        with self._db.transaction() as conn:
            operation = self._expect(operation_id, expected)
            conn.execute(
                "UPDATE operations SET result_status=?, error_json=?, ended_at=?, "
                "final_entry_id=?, intent_json=NULL, state_json=NULL WHERE id=?",
                (
                    status,
                    json_encode(error) if error else None,
                    self._clock(),
                    self._tip(operation.session_id),
                    operation_id,
                ),
            )
            return self.get_operation(operation_id)

    def release_operation(self, operation_id: str) -> OperationInfo:
        """Release only an operation whose result is already committed."""
        with self._db.transaction() as conn:
            operation = self.get_operation(operation_id)
            if operation.result_status is None:
                raise ConflictError("Cannot release an operation without a saved result")
            conn.execute(
                "UPDATE operations SET released_at=COALESCE(released_at, ?) WHERE id=?",
                (self._clock(), operation_id),
            )
            return self.get_operation(operation_id)

    def transition(
        self,
        operation_id: str,
        *,
        expected: OperationState | None,
        state: OperationState,
    ) -> OperationInfo:
        """Commit a typed phase only while the saved predecessor still matches."""
        encoded = encode_state(state)
        with self._db.transaction() as conn:
            operation = self._expect(operation_id, expected)
            self._validate_state(operation, state)
            conn.execute(
                "UPDATE operations SET state_json = ? WHERE id = ?", (encoded, operation_id)
            )
            return self.get_operation(operation_id)

    def _validate_state(self, operation: OperationInfo, state: OperationState) -> None:
        """Check historical links in the same transaction as the phase write."""
        if state.latest_assistant_entry_id is not None:
            from app.ai import AssistantMessage

            entry = self.get_entry(state.latest_assistant_entry_id)
            if entry.session_id != operation.session_id or not isinstance(
                entry.message, AssistantMessage
            ):
                raise InvalidRecordError("Latest assistant must be an assistant in this session")

    def record_usage(
        self,
        usage_id: str,
        usage: Usage,
        *,
        session_id: str | None = None,
        operation_id: str | None = None,
        entry_id: str | None = None,
        adjustment: bool = False,
        details: JSONValue = None,
    ) -> UsageEntry:
        """Record one stable fact; identical retries do not add another charge."""
        identity(usage_id)
        encoded = encode_usage(usage)
        encoded_details = json_encode(details) if details is not None else None
        if session_id is None and operation_id is None:
            raise InvalidRecordError("Usage needs a session or operation")
        with self._db.transaction() as conn:
            if session_id is not None:
                self.get_session(session_id)
            if operation_id is not None:
                operation = self.get_operation(operation_id)
                if operation.session_id != session_id:
                    raise InvalidRecordError("Usage and operation session differ")
            if entry_id is not None:
                entry = self.get_entry(entry_id)
                if session_id is None or entry.session_id != session_id:
                    raise InvalidRecordError("Usage history must belong to its session")
            existing = conn.execute(
                "SELECT * FROM usage_ledger WHERE id = ?", (usage_id,)
            ).fetchone()
            values = (session_id, operation_id, entry_id, encoded, int(adjustment), encoded_details)
            if existing:
                previous = tuple(
                    existing[key]
                    for key in (
                        "session_id",
                        "operation_id",
                        "entry_id",
                        "usage_json",
                        "adjustment",
                        "details_json",
                    )
                )
                if previous != values:
                    raise ConflictError("Usage identity already contains a different fact")
                return self._usage_entry(existing)
            seq = (
                None
                if session_id is None
                else conn.execute(
                    "SELECT COALESCE(MAX(seq), -1) + 1 FROM usage_ledger WHERE session_id = ?",
                    (session_id,),
                ).fetchone()[0]
            )
            conn.execute(
                "INSERT INTO usage_ledger VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    usage_id,
                    session_id,
                    operation_id,
                    entry_id,
                    seq,
                    encoded,
                    int(adjustment),
                    encoded_details,
                ),
            )
            row = conn.execute("SELECT * FROM usage_ledger WHERE id = ?", (usage_id,)).fetchone()
            assert row is not None
            return self._usage_entry(row)

    @staticmethod
    def _usage_entry(row: sqlite3.Row) -> UsageEntry:
        """Decode exact counters and costs, not recomputed catalog estimates."""
        return UsageEntry(
            row["id"],
            row["session_id"],
            row["operation_id"],
            row["entry_id"],
            row["seq"],
            decode_usage(row["usage_json"]),
            bool(row["adjustment"]),
            json_decode(row["details_json"]) if row["details_json"] is not None else None,
        )

    def list_usage(
        self,
        *,
        session_id: str | None = None,
        operation_id: str | None = None,
        after_seq: int | None = None,
    ) -> list[UsageEntry]:
        """Query only committed usage; session sequences are stable continuation positions."""
        if session_id is None and operation_id is None:
            raise InvalidRecordError("Usage query requires a session or operation")
        if after_seq is not None and session_id is None:
            raise InvalidRecordError("Usage sequence belongs to a session")
        with self._db.transaction(write=False) as conn:
            if session_id is not None:
                self.get_session(session_id)
            if operation_id is not None:
                operation = self.get_operation(operation_id)
                if session_id is not None and operation.session_id != session_id:
                    raise InvalidRecordError("Usage query crosses sessions")
            rows = conn.execute(
                "SELECT * FROM usage_ledger WHERE (? IS NULL OR session_id=?) "
                "AND (? IS NULL OR operation_id=?) AND (? IS NULL OR seq>?) ORDER BY seq, rowid",
                (session_id, session_id, operation_id, operation_id, after_seq, after_seq),
            )
            return [self._usage_entry(row) for row in rows]

    def summarize_usage(
        self,
        *,
        session_id: str | None = None,
        operation_id: str | None = None,
    ) -> UsageSummary:
        """Sum ledger facts once, retaining unknowns and separating currencies."""
        entries = self.list_usage(session_id=session_id, operation_id=operation_id)
        usages = [entry.usage for entry in entries]
        counts: dict[str, int | None] = {}
        for field in ("input", "output", "cache_read", "cache_write", "reasoning", "total_tokens"):
            values: list[int | None] = [getattr(usage, field) for usage in usages]
            counts[field] = (
                None if any(v is None for v in values) else sum(v for v in values if v is not None)
            )
        currencies = {usage.cost.currency for usage in usages if usage.cost is not None}
        unknown = any(usage.cost is None for usage in usages)
        costs: dict[str, UsageCost] = {}
        for currency in currencies:
            amounts: dict[str, Decimal | None] = {}
            for field in ("input", "output", "cache_read", "cache_write", "total"):
                values_money: list[Decimal | None] = [
                    getattr(usage.cost, field)
                    for usage in usages
                    if usage.cost is not None and usage.cost.currency == currency
                ]
                if unknown or any(value is None for value in values_money):
                    amounts[field] = None
                else:
                    known = [v for v in values_money if v is not None]
                    # Use enough precision for exact addition even for widely separated exponents.
                    with localcontext() as context:
                        context.prec = max(
                            28,
                            max((v.adjusted() for v in known), default=0)
                            - min((int(v.as_tuple().exponent) for v in known), default=0)
                            + len(str(len(known)))
                            + 2,
                        )
                        amounts[field] = sum(known, Decimal(0))
            costs[currency] = UsageCost(currency=currency, **amounts)
        return UsageSummary(
            Usage(
                input=counts["input"],
                output=counts["output"],
                cache_read=counts["cache_read"],
                cache_write=counts["cache_write"],
                reasoning=counts["reasoning"],
                total_tokens=counts["total_tokens"],
            ),
            costs,
            unknown,
        )
