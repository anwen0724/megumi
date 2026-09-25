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

CREATE TABLE usage_ledger (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    operation_id TEXT REFERENCES operations(id) ON DELETE CASCADE,
    entry_id TEXT REFERENCES session_entries(id) ON DELETE CASCADE,
    seq INTEGER CHECK(seq >= 0),
    usage_json TEXT NOT NULL CHECK(json_valid(usage_json)),
    adjustment INTEGER NOT NULL CHECK(adjustment IN (0, 1)),
    details_json TEXT CHECK(details_json IS NULL OR json_valid(details_json)),
    UNIQUE(session_id, seq),
    FOREIGN KEY(session_id, operation_id) REFERENCES operations(session_id, id),
    FOREIGN KEY(session_id, entry_id) REFERENCES session_entries(session_id, id),
    CHECK(session_id IS NOT NULL OR operation_id IS NOT NULL),
    CHECK((session_id IS NULL AND seq IS NULL AND entry_id IS NULL)
       OR (session_id IS NOT NULL AND seq IS NOT NULL))
);
CREATE INDEX usage_operation ON usage_ledger(operation_id);
CREATE INDEX usage_entry ON usage_ledger(entry_id);

CREATE TABLE assistant_message_frames (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    response_entry_id TEXT NOT NULL,
    frame_index INTEGER NOT NULL CHECK(frame_index >= 0),
    frame_json TEXT NOT NULL CHECK(json_valid(frame_json)),
    UNIQUE(response_entry_id, frame_index),
    FOREIGN KEY(session_id, operation_id) REFERENCES operations(session_id, id)
);
CREATE INDEX frames_operation ON assistant_message_frames(operation_id);

CREATE TABLE tool_executions (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    assistant_entry_id TEXT NOT NULL REFERENCES session_entries(id) ON DELETE CASCADE,
    source_index INTEGER NOT NULL CHECK(source_index >= 0),
    status TEXT NOT NULL CHECK(status IN ('planned', 'effect_pending', 'outcome_ready', 'completed')),
    arguments_json TEXT CHECK(arguments_json IS NULL OR json_valid(arguments_json)),
    replay_policy TEXT CHECK(replay_policy IN ('never', 'safe')),
    partial_result_json TEXT CHECK(partial_result_json IS NULL OR json_valid(partial_result_json)),
    memos_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(memos_json)),
    pending_result_json TEXT CHECK(pending_result_json IS NULL OR json_valid(pending_result_json)),
    terminate INTEGER CHECK(terminate IN (0, 1)),
    UNIQUE(assistant_entry_id, source_index),
    FOREIGN KEY(session_id, operation_id) REFERENCES operations(session_id, id),
    FOREIGN KEY(session_id, assistant_entry_id) REFERENCES session_entries(session_id, id),
    CHECK(status != 'planned' OR (arguments_json IS NULL AND replay_policy IS NULL
        AND pending_result_json IS NULL AND terminate IS NULL)),
    CHECK(status != 'effect_pending' OR (arguments_json IS NOT NULL AND replay_policy IS NOT NULL
        AND pending_result_json IS NULL AND terminate IS NULL)),
    CHECK(status != 'outcome_ready' OR (pending_result_json IS NOT NULL AND terminate IS NOT NULL
        AND partial_result_json IS NULL AND memos_json = '{}')),
    CHECK(status != 'completed' OR (pending_result_json IS NULL AND terminate IS NOT NULL
        AND partial_result_json IS NULL AND memos_json = '{}'))
);
CREATE INDEX tools_operation ON tool_executions(operation_id);
