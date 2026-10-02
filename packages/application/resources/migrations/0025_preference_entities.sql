CREATE TABLE discovery_preference_sets (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('interest','exploration')),
  interest_id TEXT REFERENCES discovery_interests(id),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((scope='interest' AND interest_id IS NOT NULL) OR (scope='exploration' AND interest_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_preference_sets_interest ON discovery_preference_sets(interest_id) WHERE interest_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_preference_sets_exploration ON discovery_preference_sets(scope) WHERE scope='exploration';
--> statement-breakpoint
CREATE TABLE discovery_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  preference_set_id TEXT NOT NULL REFERENCES discovery_preference_sets(id) ON DELETE CASCADE,
  polarity TEXT NOT NULL CHECK(polarity IN ('positive','negative')),
  dimension TEXT NOT NULL CHECK(dimension IN ('topic','source','author','content_type','recency','expression_quality')),
  statement TEXT NOT NULL CHECK(length(trim(statement)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_preferences_set ON discovery_preferences(preference_set_id);
--> statement-breakpoint
CREATE TABLE discovery_preference_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  preference_id TEXT NOT NULL REFERENCES discovery_preferences(id) ON DELETE CASCADE,
  recommendation_id TEXT NOT NULL REFERENCES discovery_recommendations(id) ON DELETE CASCADE,
  reaction_revision INTEGER NOT NULL CHECK(reaction_revision>0),
  reaction TEXT NOT NULL CHECK(reaction IN ('liked','disliked')),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_preference_evidence_pair ON discovery_preference_evidence(preference_id,recommendation_id);
--> statement-breakpoint
CREATE INDEX idx_preference_evidence_recommendation ON discovery_preference_evidence(recommendation_id);
--> statement-breakpoint
CREATE TABLE __preference_set_ids (scope_key TEXT PRIMARY KEY NOT NULL, id TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO __preference_set_ids SELECT scope_key,
  lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))
FROM discovery_preference_scopes;
--> statement-breakpoint
INSERT INTO discovery_preference_sets
SELECT m.id,s.scope,s.interest_id,s.revision,s.updated_at,s.updated_at
FROM discovery_preference_scopes s JOIN __preference_set_ids m USING(scope_key);
--> statement-breakpoint
INSERT INTO discovery_preferences
SELECT d.direction_id,m.id,d.polarity,d.dimension,d.statement,d.updated_at,d.updated_at
FROM discovery_preference_directions d JOIN __preference_set_ids m USING(scope_key);
--> statement-breakpoint
INSERT INTO discovery_preference_evidence
SELECT e.id,e.direction_id,e.recommendation_id,s.learned_reaction_revision,s.learned_reaction,p.updated_at
FROM discovery_preference_direction_recommendations e
JOIN discovery_recommendation_states s ON s.recommendation_id=e.recommendation_id
JOIN discovery_preferences p ON p.id=e.direction_id
WHERE s.learned_reaction_revision>0 AND s.learned_reaction IS NOT NULL;
--> statement-breakpoint
UPDATE discovery_recommendations SET selection_basis_json=json_set(selection_basis_json,'$.preferenceRevisions',
  json(COALESCE((SELECT json_group_array(json_object(
    'preferenceSetId',COALESCE(m.id,json_extract(j.value,'$.scopeKey')),
    'revision',json_extract(j.value,'$.revision')))
    FROM json_each(discovery_recommendations.selection_basis_json,'$.preferenceRevisions') j
    LEFT JOIN __preference_set_ids m ON m.scope_key=json_extract(j.value,'$.scopeKey')), '[]')));
--> statement-breakpoint
DROP TABLE __preference_set_ids;
--> statement-breakpoint
DROP TABLE discovery_preference_direction_recommendations;
--> statement-breakpoint
DROP TABLE discovery_preference_directions;
--> statement-breakpoint
DROP TABLE discovery_preference_scopes;
--> statement-breakpoint
DROP TABLE discovery_preference_learning_batches;
