-- Initial schema for the independent Agent database.
CREATE TABLE sessions (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT,
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    archived_at INTEGER
);
CREATE INDEX sessions_activity ON sessions(archived_at, last_activity_at DESC, id);
