-- Preserve identities while separating learned judgments from explicit user requirements.
ALTER TABLE discovery_preference_sets ADD COLUMN processed_revision INTEGER CHECK(processed_revision IS NULL OR (processed_revision >= 0 AND processed_revision <= revision));
--> statement-breakpoint
ALTER TABLE discovery_preference_sets ADD COLUMN policy_revision INTEGER NOT NULL DEFAULT 0 CHECK(policy_revision >= 0);
--> statement-breakpoint
ALTER TABLE discovery_preference_sets ADD COLUMN last_outcome TEXT CHECK(last_outcome IN ('changed','unchanged','insufficient'));
--> statement-breakpoint
ALTER TABLE discovery_recommendation_states ADD COLUMN reaction_sequence INTEGER NOT NULL DEFAULT 0 CHECK(reaction_sequence >= 0);
--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY reaction_changed_at, id) AS sequence
  FROM discovery_recommendation_states WHERE reaction_revision > 0
)
UPDATE discovery_recommendation_states SET reaction_sequence = (SELECT sequence FROM ranked WHERE ranked.id=discovery_recommendation_states.id) WHERE reaction_revision > 0;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_recommendation_states_reaction_sequence ON discovery_recommendation_states(reaction_sequence) WHERE reaction_sequence > 0;
--> statement-breakpoint
ALTER TABLE discovery_interests ADD COLUMN description_user_edited_at TEXT;
--> statement-breakpoint
UPDATE discovery_interests SET description_user_edited_at=user_managed_at WHERE user_managed_at IS NOT NULL;
--> statement-breakpoint
CREATE TABLE discovery_preferences_next (
  id TEXT PRIMARY KEY NOT NULL,
  preference_set_id TEXT NOT NULL REFERENCES discovery_preference_sets(id) ON DELETE CASCADE,
  origin TEXT NOT NULL CHECK(origin IN ('learned','user')),
  polarity TEXT CHECK(polarity IN ('positive','negative')),
  dimension TEXT CHECK(dimension IN ('topic','source','author','content_type','recency','expression_quality')),
  statement TEXT NOT NULL CHECK(length(trim(statement)) BETWEEN 1 AND 1000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  status TEXT NOT NULL CHECK(status IN ('active','needs_review','retired','deleted')),
  user_edited_at TEXT,
  deleted_at TEXT,
  deleted_feedback_sequence INTEGER CHECK(deleted_feedback_sequence >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((origin='learned' AND polarity IS NOT NULL AND dimension IS NOT NULL AND user_edited_at IS NULL)
    OR (origin='user' AND polarity IS NULL AND dimension IS NULL AND user_edited_at IS NOT NULL AND status IN ('active','deleted'))),
  CHECK((status='deleted' AND deleted_at IS NOT NULL AND deleted_feedback_sequence IS NOT NULL)
    OR (status<>'deleted' AND deleted_at IS NULL AND deleted_feedback_sequence IS NULL))
);
--> statement-breakpoint
INSERT INTO discovery_preferences_next (id,preference_set_id,origin,polarity,dimension,statement,revision,status,created_at,updated_at)
SELECT id,preference_set_id,'learned',polarity,dimension,statement,1,'needs_review',created_at,updated_at FROM discovery_preferences;
--> statement-breakpoint
CREATE TABLE discovery_preference_evidence_next (
  id TEXT PRIMARY KEY NOT NULL,
  preference_id TEXT NOT NULL REFERENCES discovery_preferences_next(id) ON DELETE CASCADE,
  recommendation_id TEXT NOT NULL REFERENCES discovery_recommendations(id) ON DELETE RESTRICT,
  reaction_revision INTEGER NOT NULL CHECK(reaction_revision > 0),
  reaction TEXT NOT NULL CHECK(reaction IN ('liked','disliked')),
  relation TEXT NOT NULL CHECK(relation IN ('support','counter')),
  explanation TEXT CHECK(explanation IS NULL OR length(trim(explanation)) BETWEEN 1 AND 1000),
  content_quote TEXT CHECK(content_quote IS NULL OR length(content_quote) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO discovery_preference_evidence_next (id,preference_id,recommendation_id,reaction_revision,reaction,relation,created_at,updated_at)
SELECT id,preference_id,recommendation_id,reaction_revision,reaction,'support',created_at,created_at FROM discovery_preference_evidence;
--> statement-breakpoint
DROP TABLE discovery_preference_evidence;
--> statement-breakpoint
DROP TABLE discovery_preferences;
--> statement-breakpoint
ALTER TABLE discovery_preferences_next RENAME TO discovery_preferences;
--> statement-breakpoint
ALTER TABLE discovery_preference_evidence_next RENAME TO discovery_preference_evidence;
--> statement-breakpoint
CREATE INDEX idx_preferences_set ON discovery_preferences(preference_set_id,status,origin);
--> statement-breakpoint
CREATE INDEX idx_preferences_deleted_feedback ON discovery_preferences(preference_set_id,deleted_feedback_sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_preference_evidence_pair ON discovery_preference_evidence(preference_id,recommendation_id);
--> statement-breakpoint
CREATE INDEX idx_preference_evidence_recommendation ON discovery_preference_evidence(recommendation_id,reaction_revision);
