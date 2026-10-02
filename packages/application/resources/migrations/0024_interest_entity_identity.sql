ALTER TABLE discovery_interests RENAME COLUMN interest_id TO id;
--> statement-breakpoint
ALTER TABLE discovery_interest_evidence RENAME COLUMN evidence_id TO id;
--> statement-breakpoint
CREATE TABLE discovery_interest_session_settings (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  participation TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT check_discovery_interest_session_settings_participation CHECK(participation IN ('included', 'excluded'))
);
--> statement-breakpoint
INSERT INTO discovery_interest_session_settings (id, session_id, participation, effective_from, created_at, updated_at)
SELECT session_participation_id, session_id, participation, effective_from, updated_at, updated_at
FROM discovery_session_policies;
--> statement-breakpoint
DROP TABLE discovery_session_policies;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_discovery_interest_session_settings_session ON discovery_interest_session_settings(session_id);
--> statement-breakpoint
CREATE TRIGGER check_interest_revision_insert BEFORE INSERT ON discovery_interests
WHEN NEW.revision < 0 BEGIN SELECT RAISE(ABORT, 'Interest revision must be nonnegative'); END;
--> statement-breakpoint
CREATE TRIGGER check_interest_revision_update BEFORE UPDATE OF revision ON discovery_interests
WHEN NEW.revision < 0 BEGIN SELECT RAISE(ABORT, 'Interest revision must be nonnegative'); END;
