CREATE TEMP TABLE legacy_contents AS SELECT * FROM contents;
--> statement-breakpoint
CREATE TEMP TABLE legacy_content_analysis AS SELECT * FROM content_analysis;
--> statement-breakpoint
CREATE TEMP TABLE legacy_content_interest_matches AS SELECT * FROM content_interest_matches;
--> statement-breakpoint
CREATE TEMP TABLE legacy_recommendation_candidates AS SELECT * FROM recommendation_candidates;
--> statement-breakpoint
CREATE TEMP TABLE legacy_search_results AS SELECT * FROM search_results;
--> statement-breakpoint
CREATE TEMP TABLE legacy_search_history AS SELECT * FROM search_history;
--> statement-breakpoint
CREATE TEMP TABLE legacy_search_queries AS SELECT * FROM search_queries;
--> statement-breakpoint
CREATE TEMP TABLE legacy_candidate_supply_state AS SELECT * FROM candidate_supply_state;
--> statement-breakpoint
DROP TRIGGER retire_queries_on_interest_delete;
--> statement-breakpoint
DROP TABLE content_interest_matches;
--> statement-breakpoint
DROP TABLE recommendation_candidates;
--> statement-breakpoint
DROP TABLE content_analysis;
--> statement-breakpoint
DROP TABLE search_results;
--> statement-breakpoint
DROP TABLE search_history;
--> statement-breakpoint
DROP TABLE search_queries;
--> statement-breakpoint
DROP TABLE candidate_supply_state;
--> statement-breakpoint
UPDATE contents SET duplicate_group_id = NULL;
--> statement-breakpoint
DROP TABLE contents;
--> statement-breakpoint
CREATE TABLE contents (
  id TEXT PRIMARY KEY NOT NULL, platform TEXT NOT NULL, external_id TEXT, canonical_url TEXT NOT NULL UNIQUE,
  title TEXT, author TEXT, author_id TEXT, language TEXT, current_material_id TEXT, duplicate_group_id TEXT REFERENCES contents(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  FOREIGN KEY (current_material_id,id) REFERENCES content_materials(id,content_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_contents_platform_external ON contents(platform,external_id) WHERE external_id IS NOT NULL AND external_id <> '';
--> statement-breakpoint
CREATE TABLE content_materials (
  id TEXT PRIMARY KEY NOT NULL, content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE, revision INTEGER NOT NULL CHECK(revision > 0),
  title TEXT, author TEXT, text TEXT NOT NULL CHECK(length(text) > 0), text_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('full_text','excerpt','description','transcript')), truncated INTEGER NOT NULL CHECK(truncated IN (0,1)),
  range_start INTEGER NOT NULL DEFAULT 0 CHECK(range_start >= 0), range_end INTEGER NOT NULL CHECK(range_end > range_start),
  method TEXT NOT NULL, acquired_at INTEGER NOT NULL, publication_evidence TEXT NOT NULL CHECK(json_valid(publication_evidence)),
  UNIQUE(content_id,revision), UNIQUE(id,content_id)
);
--> statement-breakpoint
CREATE TRIGGER content_materials_immutable BEFORE UPDATE ON content_materials BEGIN SELECT RAISE(ABORT,'Material versions are immutable'); END;
--> statement-breakpoint
CREATE TABLE material_acquisitions (
  id TEXT PRIMARY KEY NOT NULL, material_id TEXT NOT NULL REFERENCES content_materials(id) ON DELETE CASCADE,
  method TEXT NOT NULL, acquired_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE discovery_runs (
  id TEXT PRIMARY KEY NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('daily_feed','candidate_supply')), status TEXT NOT NULL CHECK(status IN ('running','completed','partial','failed','cancelled','interrupted')),
  interest_snapshot TEXT NOT NULL CHECK(json_valid(interest_snapshot)), config_revision TEXT NOT NULL, accepted_plan TEXT CHECK(accepted_plan IS NULL OR json_valid(accepted_plan)),
  next_step TEXT, yield_summary TEXT CHECK(yield_summary IS NULL OR json_valid(yield_summary)), started_at INTEGER NOT NULL, finished_at INTEGER,
  budget TEXT NOT NULL CHECK(json_valid(budget)), issues TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(issues))
);
--> statement-breakpoint
CREATE TABLE material_requests (
  owner_run_id TEXT REFERENCES discovery_runs(id) ON DELETE RESTRICT, attempt_token TEXT, attempt_started_at INTEGER, attempt_deadline_at INTEGER, id TEXT PRIMARY KEY NOT NULL, content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  discovery_run_id TEXT REFERENCES discovery_runs(id), method TEXT NOT NULL, request_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','ready','failed','cancelled')), attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), retry_at INTEGER, error_code TEXT, CHECK ((owner_run_id IS NULL AND attempt_token IS NULL AND attempt_started_at IS NULL AND attempt_deadline_at IS NULL) OR (owner_run_id IS NOT NULL AND attempt_token IS NOT NULL AND attempt_started_at IS NOT NULL AND attempt_deadline_at > attempt_started_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_material_requests_active ON material_requests(content_id,method) WHERE status IN ('pending','running');
--> statement-breakpoint
CREATE TABLE content_analysis (
  owner_run_id TEXT REFERENCES discovery_runs(id) ON DELETE RESTRICT, attempt_token TEXT, attempt_started_at INTEGER, attempt_deadline_at INTEGER, content_id TEXT NOT NULL, material_id TEXT NOT NULL, contract_version INTEGER NOT NULL CHECK(contract_version > 0),
  status TEXT NOT NULL CHECK(status IN ('pending','running','ready','failed','cancelled')), attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), retry_at INTEGER,
  result TEXT CHECK(result IS NULL OR json_valid(result)), analyzed_at INTEGER, error_code TEXT,
  FOREIGN KEY(material_id,content_id) REFERENCES content_materials(id,content_id) ON DELETE CASCADE,
  PRIMARY KEY(content_id,material_id,contract_version), CHECK ((owner_run_id IS NULL AND attempt_token IS NULL AND attempt_started_at IS NULL AND attempt_deadline_at IS NULL) OR (owner_run_id IS NOT NULL AND attempt_token IS NOT NULL AND attempt_started_at IS NOT NULL AND attempt_deadline_at > attempt_started_at))
);
--> statement-breakpoint
CREATE TABLE recommendation_candidates (
  owner_run_id TEXT REFERENCES discovery_runs(id) ON DELETE RESTRICT, attempt_token TEXT, attempt_started_at INTEGER, attempt_deadline_at INTEGER, content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE, interest_id TEXT NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
  interest_revision INTEGER NOT NULL CHECK(interest_revision > 0), material_id TEXT NOT NULL,
  analysis_contract_version INTEGER NOT NULL, matching_contract_version INTEGER NOT NULL,
  relation TEXT NOT NULL CHECK(relation IN ('direct','related','none')), status TEXT NOT NULL CHECK(status IN ('eligible','rejected','pending','stale')),
  basis TEXT, evidence TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence)), reviewed_at INTEGER, valid_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), retry_at INTEGER, error_code TEXT,
  FOREIGN KEY(material_id,content_id) REFERENCES content_materials(id,content_id) ON DELETE CASCADE,
  FOREIGN KEY(content_id,material_id,analysis_contract_version) REFERENCES content_analysis(content_id,material_id,contract_version) ON DELETE CASCADE,
  PRIMARY KEY(content_id,interest_id), CHECK ((owner_run_id IS NULL AND attempt_token IS NULL AND attempt_started_at IS NULL AND attempt_deadline_at IS NULL) OR (owner_run_id IS NOT NULL AND attempt_token IS NOT NULL AND attempt_started_at IS NOT NULL AND attempt_deadline_at > attempt_started_at))
);
--> statement-breakpoint
CREATE INDEX idx_candidates_current ON recommendation_candidates(interest_id,interest_revision,status,valid_until);
--> statement-breakpoint
CREATE TABLE candidate_selection_inputs (
  run_id TEXT NOT NULL REFERENCES recommendation_runs(id) ON DELETE CASCADE, content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  interest_id TEXT NOT NULL REFERENCES interests(id) ON DELETE CASCADE, interest_revision INTEGER NOT NULL, recorded_at INTEGER NOT NULL,
  PRIMARY KEY(run_id,content_id,interest_id)
);
--> statement-breakpoint
CREATE TABLE search_queries (
  id TEXT PRIMARY KEY NOT NULL, interest_id TEXT REFERENCES interests(id) ON DELETE SET NULL, interest_revision INTEGER NOT NULL,
  query TEXT NOT NULL CHECK(length(query) BETWEEN 1 AND 200), category TEXT NOT NULL CHECK(category IN ('core','entity','technical','exploratory','trend')),
  origin TEXT NOT NULL CHECK(origin IN ('ai','interest')), status TEXT NOT NULL CHECK(status IN ('active','retired')), last_used_at INTEGER, created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_search_queries_active_identity ON search_queries(interest_id,interest_revision,query) WHERE status = 'active';
--> statement-breakpoint
CREATE TABLE search_history (
  id TEXT PRIMARY KEY NOT NULL, query_id TEXT NOT NULL REFERENCES search_queries(id), source_id TEXT NOT NULL, search_scope TEXT NOT NULL CHECK(json_valid(search_scope)),
  searched_at INTEGER NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('success','failed')), result_count INTEGER, new_item_count INTEGER,
  run_id TEXT REFERENCES discovery_runs(id), purpose TEXT NOT NULL CHECK(purpose IN ('legacy','daily_feed','candidate_supply')), window_start INTEGER, window_end INTEGER, error_code TEXT
);
--> statement-breakpoint
CREATE INDEX idx_search_history_source_purpose_query_date ON search_history(source_id,purpose,query_id,searched_at);
--> statement-breakpoint
CREATE TABLE search_results (
  id TEXT PRIMARY KEY NOT NULL, platform TEXT NOT NULL, source_id TEXT NOT NULL, external_id TEXT, request_url TEXT NOT NULL,
  title TEXT, excerpt TEXT, author TEXT, publication_evidence TEXT NOT NULL CHECK(json_valid(publication_evidence)), raw_payload TEXT,
  content_id TEXT REFERENCES contents(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','normalized','rejected','failed')), attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER, error_code TEXT,
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, UNIQUE(platform,request_url)
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_search_results_external ON search_results(platform,external_id) WHERE external_id IS NOT NULL AND external_id <> '';
--> statement-breakpoint
CREATE TABLE search_result_links (
  search_history_id TEXT NOT NULL REFERENCES search_history(id) ON DELETE CASCADE,
  search_result_id TEXT NOT NULL REFERENCES search_results(id) ON DELETE CASCADE, PRIMARY KEY(search_history_id,search_result_id)
);
--> statement-breakpoint
CREATE TABLE daily_feed_batches (
  id TEXT PRIMARY KEY NOT NULL, date TEXT NOT NULL, timezone TEXT NOT NULL, interest_id TEXT NOT NULL,
  interest_revision INTEGER NOT NULL, interest_text TEXT NOT NULL, window_start INTEGER NOT NULL, window_end INTEGER NOT NULL CHECK(window_end > window_start),
  status TEXT NOT NULL CHECK(status IN ('ready','partial','empty','failed')), committed_at INTEGER NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(issues)), UNIQUE(date,interest_id,interest_revision)
);
--> statement-breakpoint
CREATE TABLE daily_feed_items (
  batch_id TEXT NOT NULL REFERENCES daily_feed_batches(id) ON DELETE CASCADE, content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
  material_id TEXT NOT NULL, display_order INTEGER NOT NULL, title_snapshot TEXT NOT NULL, summary_snapshot TEXT NOT NULL,
  publication_snapshot TEXT NOT NULL CHECK(json_valid(publication_snapshot)), PRIMARY KEY(batch_id,content_id), UNIQUE(batch_id,display_order),
  FOREIGN KEY(material_id,content_id) REFERENCES content_materials(id,content_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE curated_selections (
  id TEXT PRIMARY KEY NOT NULL, interest_snapshot TEXT NOT NULL CHECK(json_valid(interest_snapshot)), created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ready','retired'))
);
--> statement-breakpoint
CREATE TABLE curated_selection_items (
  selection_id TEXT NOT NULL REFERENCES curated_selections(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE RESTRICT, material_id TEXT NOT NULL, display_order INTEGER NOT NULL,
  matched_interests TEXT NOT NULL CHECK(json_valid(matched_interests)), reason TEXT NOT NULL, evidence TEXT NOT NULL CHECK(json_valid(evidence)),
  PRIMARY KEY(selection_id,content_id), UNIQUE(selection_id,display_order), FOREIGN KEY(material_id,content_id) REFERENCES content_materials(id,content_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE favorites (
  content_id TEXT PRIMARY KEY REFERENCES contents(id) ON DELETE RESTRICT, material_id TEXT NOT NULL, title_snapshot TEXT NOT NULL, created_at INTEGER NOT NULL,
  FOREIGN KEY(material_id,content_id) REFERENCES content_materials(id,content_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE recommendation_runs (
  id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('daily_feed','curated')), request_id TEXT NOT NULL UNIQUE,
  retry_of_run_id TEXT REFERENCES recommendation_runs(id), input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','partial','failed','cancelled','interrupted','input_changed')),
  interest_snapshot TEXT NOT NULL CHECK(json_valid(interest_snapshot)), candidate_snapshot TEXT NOT NULL CHECK(json_valid(candidate_snapshot)),
  daily_feed_batch_id TEXT REFERENCES daily_feed_batches(id) ON DELETE RESTRICT, curated_selection_id TEXT REFERENCES curated_selections(id) ON DELETE RESTRICT,
  result_id TEXT GENERATED ALWAYS AS (coalesce(daily_feed_batch_id,curated_selection_id)) VIRTUAL, outcome TEXT CHECK(outcome IS NULL OR json_valid(outcome)), error TEXT CHECK(error IS NULL OR json_valid(error)), started_at INTEGER NOT NULL, finished_at INTEGER,
  CHECK ((daily_feed_batch_id IS NULL OR kind = 'daily_feed') AND (curated_selection_id IS NULL OR kind = 'curated'))
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
CREATE TABLE recommendation_state (
  id INTEGER PRIMARY KEY CHECK(id = 1), current_selection_id TEXT REFERENCES curated_selections(id) ON DELETE RESTRICT,
  pending_initial_interest_hash TEXT, finished_automatic_interest_hash TEXT, automatic_retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER
);
--> statement-breakpoint
CREATE TABLE candidate_supply_state (
  id INTEGER PRIMARY KEY CHECK(id = 1), source_cooldowns TEXT NOT NULL CHECK(json_valid(source_cooldowns)),
  search_backoff TEXT NOT NULL CHECK(json_valid(search_backoff)), candidate_next_interest_id TEXT, daily_feed_next_interest_id TEXT, last_finished_at INTEGER
);
--> statement-breakpoint
CREATE INDEX idx_material_requests_status_retry ON material_requests(status,retry_at);
--> statement-breakpoint
CREATE INDEX idx_content_analysis_status_retry ON content_analysis(status,retry_at);
--> statement-breakpoint
CREATE INDEX idx_recommendation_candidates_status_retry ON recommendation_candidates(status,retry_at);
--> statement-breakpoint
CREATE INDEX idx_recommendation_run_judgments_status_retry ON recommendation_run_judgments(status,retry_at);
--> statement-breakpoint
CREATE INDEX idx_search_results_status_retry ON search_results(status,retry_at);
--> statement-breakpoint
CREATE INDEX idx_daily_feed_date_interest ON daily_feed_batches(date,interest_id,interest_revision);
--> statement-breakpoint
CREATE INDEX idx_favorites_created ON favorites(created_at,content_id);
--> statement-breakpoint
INSERT INTO contents(id,platform,canonical_url,title,author,language,created_at,updated_at) SELECT id,source,canonical_url,title,author,language,created_at,updated_at FROM legacy_contents;
--> statement-breakpoint
INSERT INTO content_materials(id,content_id,revision,title,author,text,text_hash,kind,truncated,range_end,method,acquired_at,publication_evidence) SELECT 'legacy:'||id,id,1,title,author,text,sha256(text),'excerpt',0,length(text),'legacy',created_at,json_array(json_object('kind',CASE WHEN source = 'zhihu' AND published_at IS NOT NULL THEN 'modified' ELSE 'unknown' END,'value',published_at,'precision',CASE WHEN published_at IS NULL THEN 'unknown' ELSE 'instant' END,'timezone','UTC','location','legacy.contents.published_at','rawValue',CASE WHEN published_at IS NULL THEN NULL ELSE CAST(published_at AS TEXT) END,'status','unverified')) FROM legacy_contents;
--> statement-breakpoint
UPDATE contents SET current_material_id = 'legacy:'||id, duplicate_group_id = (SELECT duplicate_group_id FROM legacy_contents old WHERE old.id = contents.id);
--> statement-breakpoint
INSERT INTO material_acquisitions SELECT 'legacy:'||id,'legacy:'||id,'legacy',created_at FROM legacy_contents;
--> statement-breakpoint
INSERT INTO content_analysis(content_id,material_id,contract_version,status,attempts,retry_at,analyzed_at,result) SELECT content_id,'legacy:'||content_id,1,status,attempts,retry_at,analyzed_at,json_object('summary',summary,'keyPoints',json(key_points),'topics',json(topics),'entities',json(entities),'contentType',content_type,'qualityScore',quality_score,'spamScore',spam_score,'longTermValue',long_term_value) FROM legacy_content_analysis;
--> statement-breakpoint
INSERT INTO content_analysis(content_id,material_id,contract_version,status) SELECT id,'legacy:'||id,1,'pending' FROM legacy_contents WHERE id NOT IN (SELECT content_id FROM legacy_content_analysis);
--> statement-breakpoint
INSERT INTO recommendation_candidates(content_id,interest_id,interest_revision,material_id,analysis_contract_version,matching_contract_version,relation,status,basis,reviewed_at) SELECT m.content_id,m.interest_id,m.interest_revision,'legacy:'||m.content_id,1,1,m.relation,'stale',m.basis,m.matched_at FROM legacy_content_interest_matches m;
--> statement-breakpoint
INSERT INTO search_queries(id,interest_id,interest_revision,query,category,origin,status,last_used_at,created_at) SELECT id,interest_id,interest_revision,query,category,origin,status,last_used_at,created_at FROM legacy_search_queries;
--> statement-breakpoint
INSERT INTO search_history(id,query_id,source_id,search_scope,searched_at,outcome,result_count,new_item_count,purpose) SELECT id,query_id,source,search_scope,searched_at,outcome,result_count,new_item_count,'legacy' FROM legacy_search_history;
--> statement-breakpoint
INSERT INTO search_results(id,platform,source_id,external_id,request_url,title,excerpt,author,publication_evidence,raw_payload,content_id,status,attempts,retry_at,error_code,first_seen_at,last_seen_at) SELECT id,source,source,external_id,url,title,description,author,json_array(json_object('kind',CASE WHEN source = 'zhihu' AND published_at IS NOT NULL THEN 'modified' ELSE 'unknown' END,'value',published_at,'precision',CASE WHEN published_at IS NULL THEN 'unknown' ELSE 'instant' END,'timezone','UTC','location','legacy.search_results.published_at','rawValue',CASE WHEN published_at IS NULL THEN NULL ELSE CAST(published_at AS TEXT) END,'status','unverified')),raw_payload,content_id,status,attempts,retry_at,last_error_code,merged_first_seen,last_seen_at FROM (
  SELECT legacy_search_results.*,
    min(first_seen_at) OVER (PARTITION BY source,coalesce(nullif(external_id,''),url)) AS merged_first_seen,
    row_number() OVER (PARTITION BY source,coalesce(nullif(external_id,''),url) ORDER BY (content_id IS NULL),last_seen_at DESC,id) AS identity_rank
  FROM legacy_search_results
) WHERE identity_rank = 1;
--> statement-breakpoint
INSERT INTO candidate_supply_state(id,source_cooldowns,search_backoff,candidate_next_interest_id,last_finished_at) SELECT id,source_cooldowns,'{}',next_interest_id,last_finished_at FROM legacy_candidate_supply_state;
--> statement-breakpoint
INSERT INTO recommendation_state(id) VALUES(1);
--> statement-breakpoint
DROP TABLE legacy_contents;
--> statement-breakpoint
DROP TABLE legacy_content_analysis;
--> statement-breakpoint
DROP TABLE legacy_content_interest_matches;
--> statement-breakpoint
DROP TABLE legacy_recommendation_candidates;
--> statement-breakpoint
DROP TABLE legacy_search_results;
--> statement-breakpoint
DROP TABLE legacy_search_history;
--> statement-breakpoint
DROP TABLE legacy_search_queries;
--> statement-breakpoint
DROP TABLE legacy_candidate_supply_state;
