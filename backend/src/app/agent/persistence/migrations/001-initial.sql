-- Initial schema for the independent Agent database.
CREATE TABLE sessions (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT,
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    archived_at INTEGER
);
CREATE INDEX sessions_activity ON sessions(archived_at, last_activity_at DESC, id);

CREATE TABLE operations (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('run', 'compaction')),
    intent_json TEXT CHECK(intent_json IS NULL OR json_valid(intent_json)),
    state_json TEXT CHECK(state_json IS NULL OR json_valid(state_json)),
    base_entry_id TEXT,
    final_entry_id TEXT,
    result_status TEXT CHECK(result_status IN ('completed', 'declined', 'aborted', 'failed')),
    error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
    accepted_at INTEGER NOT NULL,
    ended_at INTEGER,
    released_at INTEGER,
    UNIQUE(session_id, id),
    FOREIGN KEY(session_id, base_entry_id) REFERENCES session_entries(session_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(session_id, final_entry_id) REFERENCES session_entries(session_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    CHECK(session_id IS NOT NULL OR (base_entry_id IS NULL AND final_entry_id IS NULL)),
    CHECK((result_status IS NULL AND ended_at IS NULL AND released_at IS NULL
        AND intent_json IS NOT NULL AND state_json IS NOT NULL AND error_json IS NULL)
      OR (result_status IS NOT NULL AND ended_at IS NOT NULL
        AND intent_json IS NULL AND state_json IS NULL
        AND ((result_status = 'failed' AND error_json IS NOT NULL)
          OR (result_status != 'failed' AND error_json IS NULL))))
);
CREATE UNIQUE INDEX operations_unreleased ON operations(session_id) WHERE released_at IS NULL;
CREATE INDEX operations_session ON operations(session_id, accepted_at, id);

CREATE TABLE session_entries (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    operation_id TEXT REFERENCES operations(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL CHECK(seq >= 0),
    type TEXT NOT NULL CHECK(type IN ('message', 'compaction', 'custom')),
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    recorded_at INTEGER NOT NULL,
    UNIQUE(session_id, seq),
    UNIQUE(session_id, id),
    FOREIGN KEY(session_id, operation_id) REFERENCES operations(session_id, id)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX entries_operation ON session_entries(operation_id);
