CREATE TEMP TABLE saved_recommendation_run_judgments AS SELECT * FROM recommendation_run_judgments;
--> statement-breakpoint
CREATE TEMP TABLE saved_candidate_selection_inputs AS SELECT * FROM candidate_selection_inputs;
--> statement-breakpoint
CREATE TEMP TABLE saved_recommendation_runs AS SELECT * FROM recommendation_runs;
--> statement-breakpoint
UPDATE recommendation_runs SET retry_of_run_id=NULL;
--> statement-breakpoint
DROP TABLE recommendation_run_judgments;
--> statement-breakpoint
DROP TABLE candidate_selection_inputs;
--> statement-breakpoint
DROP TABLE recommendation_runs;
--> statement-breakpoint
CREATE TABLE recommendation_runs (
  id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('daily_feed','curated')), request_id TEXT NOT NULL UNIQUE,
  retry_of_run_id TEXT REFERENCES recommendation_runs(id), input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','partial','empty','failed','cancelled','interrupted','superseded')),
  interest_snapshot TEXT NOT NULL CHECK(json_valid(interest_snapshot)), candidate_snapshot TEXT NOT NULL CHECK(json_valid(candidate_snapshot)),
  daily_feed_batch_id TEXT REFERENCES daily_feed_batches(id) ON DELETE RESTRICT, curated_selection_id TEXT REFERENCES curated_selections(id) ON DELETE RESTRICT,
  result_id TEXT GENERATED ALWAYS AS (coalesce(daily_feed_batch_id,curated_selection_id)) VIRTUAL, outcome TEXT CHECK(outcome IS NULL OR json_valid(outcome)), error TEXT CHECK(error IS NULL OR json_valid(error)), started_at INTEGER NOT NULL, finished_at INTEGER,
  CHECK ((daily_feed_batch_id IS NULL OR kind = 'daily_feed') AND (curated_selection_id IS NULL OR kind = 'curated'))
);
--> statement-breakpoint
CREATE TABLE candidate_selection_inputs (
  run_id TEXT NOT NULL REFERENCES recommendation_runs(id) ON DELETE CASCADE, content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  interest_id TEXT NOT NULL REFERENCES interests(id) ON DELETE CASCADE, interest_revision INTEGER NOT NULL, recorded_at INTEGER NOT NULL,
  PRIMARY KEY(run_id,content_id,interest_id)
);
--> statement-breakpoint
CREATE TABLE recommendation_run_judgments (
  owner_run_id TEXT REFERENCES recommendation_runs(id) ON DELETE RESTRICT, attempt_token TEXT, attempt_started_at INTEGER, attempt_deadline_at INTEGER, run_id TEXT NOT NULL REFERENCES recommendation_runs(id) ON DELETE CASCADE, stage TEXT NOT NULL CHECK(stage IN ('topic','date','value')),
  content_id TEXT NOT NULL, interest_id TEXT NOT NULL, material_id TEXT NOT NULL,
  input_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','running','ready','failed','cancelled')),
  result TEXT CHECK(result IS NULL OR json_valid(result)), attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER, error_code TEXT,
  FOREIGN KEY(material_id,content_id) REFERENCES content_materials(id,content_id) ON DELETE RESTRICT,
  PRIMARY KEY(run_id,stage,content_id,interest_id), CHECK ((owner_run_id IS NULL AND attempt_token IS NULL AND attempt_started_at IS NULL AND attempt_deadline_at IS NULL) OR (owner_run_id IS NOT NULL AND attempt_token IS NOT NULL AND attempt_started_at IS NOT NULL AND attempt_deadline_at > attempt_started_at))
);
--> statement-breakpoint
INSERT INTO recommendation_runs(id,kind,request_id,retry_of_run_id,input_hash,status,interest_snapshot,candidate_snapshot,daily_feed_batch_id,curated_selection_id,outcome,error,started_at,finished_at) SELECT id,kind,request_id,retry_of_run_id,input_hash,CASE WHEN status='input_changed' THEN 'superseded' ELSE status END,interest_snapshot,candidate_snapshot,daily_feed_batch_id,curated_selection_id,outcome,error,started_at,finished_at FROM saved_recommendation_runs;
--> statement-breakpoint
INSERT INTO recommendation_run_judgments SELECT * FROM saved_recommendation_run_judgments;
--> statement-breakpoint
INSERT INTO candidate_selection_inputs SELECT * FROM saved_candidate_selection_inputs;
--> statement-breakpoint
DROP TABLE saved_recommendation_run_judgments;
--> statement-breakpoint
DROP TABLE saved_candidate_selection_inputs;
--> statement-breakpoint
DROP TABLE saved_recommendation_runs;
--> statement-breakpoint
CREATE INDEX idx_recommendation_run_judgments_status_retry ON recommendation_run_judgments(status,retry_at);
