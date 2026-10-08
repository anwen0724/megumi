/* Defines the current physical Drizzle schema without owning business queries. */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  unique,
  foreignKey,
  type SQLiteTableExtraConfigValue,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];
type JsonValue = JsonObject | JsonArray | string | number | boolean | null;

const jsonText = (name: string) => text(name, { mode: 'json' }).$type<JsonValue>();

export const memorySources = sqliteTable('memory_sources', {
  sessionId: text('session_id').primaryKey(),
  eligibility: text('eligibility').notNull().default('eligible'),
  eligibilityVersion: integer('eligibility_version').notNull().default(0),
  usageCount: integer('usage_count').notNull().default(0),
  lastUsedAt: text('last_used_at'),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check('memory_source_eligibility', sql`${table.eligibility} IN ('eligible', 'excluded')`),
  check('memory_source_counters', sql`${table.eligibilityVersion} >= 0 AND ${table.usageCount} >= 0`),
]);

export const memoryExtractions = sqliteTable('memory_extractions', {
  sessionId: text('session_id').notNull().references(() => memorySources.sessionId),
  sourceVersion: text('source_version').notNull(),
  workspaceId: text('workspace_id'),
  sourceUpdatedAt: text('source_updated_at').notNull(),
  rawMemory: text('raw_memory').notNull(),
  rolloutSummary: text('rollout_summary').notNull(),
  rolloutSlug: text('rollout_slug').notNull(),
  coverageJson: jsonText('coverage_json').notNull(),
  extractedAt: text('extracted_at').notNull(),
}, table => [primaryKey({ columns: [table.sessionId, table.sourceVersion] })]);

export const memoryCurrentExtractions = sqliteTable('memory_current_extractions', {
  sessionId: text('session_id').primaryKey(),
  sourceVersion: text('source_version').notNull(),
}, table => [foreignKey({
  columns: [table.sessionId, table.sourceVersion],
  foreignColumns: [memoryExtractions.sessionId, memoryExtractions.sourceVersion],
})]);

export const memoryRuns = sqliteTable('memory_runs', {
  runId: text('run_id').primaryKey(),
  kind: text('kind').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull(),
  targetRevision: integer('target_revision').notNull(),
  cancelRequested: integer('cancel_requested', { mode: 'boolean' }).notNull().default(false),
  resultJson: jsonText('result_json'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
}, table => [check('memory_run_status', sql`${table.status} IN ('pending','running','completed','failed','cancelled')`)]);

export const memoryJobs = sqliteTable('memory_jobs', {
  jobId: text('job_id').primaryKey(),
  runId: text('run_id').notNull().references(() => memoryRuns.runId),
  stage: text('stage').notNull(),
  sessionId: text('session_id'),
  sourceVersion: text('source_version'),
  targetRevision: integer('target_revision'),
  status: text('status').notNull(),
  attempt: integer('attempt').notNull(),
  retryGroupId: text('retry_group_id').notNull().default(''),
  retryOfJobId: text('retry_of_job_id'),
  resultJson: jsonText('result_json'),
  ownerToken: text('owner_token'),
  leaseExpiresAt: text('lease_expires_at'),
  retryAt: text('retry_at'),
  errorJson: jsonText('error_json'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
}, table => [
  check('memory_job_status', sql`${table.status} IN ('pending','running','succeeded','failed','cancelled','superseded')`),
  check('memory_job_attempt', sql`${table.attempt} > 0`),
  check('memory_job_stage', sql`${table.stage} IN ('extract','consolidate')`),
  uniqueIndex('memory_active_extraction').on(table.sessionId)
    .where(sql`${table.stage} = 'extract' AND ${table.status} IN ('pending','running')`),
  uniqueIndex('memory_active_consolidation').on(table.stage)
    .where(sql`${table.stage} = 'consolidate' AND ${table.status} IN ('pending','running')`),
]);

export const memorySnapshots = sqliteTable('memory_snapshots', {
  snapshotId: text('snapshot_id').primaryKey(),
  targetRevision: integer('target_revision').notNull(),
  diffJson: jsonText('diff_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const memorySnapshotSources = sqliteTable('memory_snapshot_sources', {
  snapshotId: text('snapshot_id').notNull().references(() => memorySnapshots.snapshotId, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  sourceVersion: text('source_version').notNull(),
  ordinal: integer('ordinal').notNull(),
  artifactPath: text('artifact_path').notNull(),
}, table => [
  primaryKey({ columns: [table.snapshotId, table.sessionId, table.sourceVersion] }),
  foreignKey({ columns: [table.sessionId, table.sourceVersion],
    foreignColumns: [memoryExtractions.sessionId, memoryExtractions.sourceVersion] }),
]);

export const memoryState = sqliteTable('memory_state', {
  id: integer('id').primaryKey(),
  artifactState: text('artifact_state').notNull().default('empty'),
  controlRevision: integer('control_revision').notNull().default(0),
  dirtyRevision: integer('dirty_revision').notNull().default(0),
  processedRevision: integer('processed_revision').notNull().default(0),
  successfulSnapshotId: text('successful_snapshot_id').references(() => memorySnapshots.snapshotId),
  artifactVersionsJson: jsonText('artifact_versions_json').notNull().default('{}'),
  clearPending: integer('clear_pending', { mode: 'boolean' }).notNull().default(false),
  replyCursor: integer('reply_cursor').notNull().default(0),
  clearReplyCursor: integer('clear_reply_cursor').notNull().default(0),
  writerToken: text('writer_token'),
  writerLeaseExpiresAt: text('writer_lease_expires_at'),
}, table => [
  check('memory_singleton', sql`${table.id} = 1`),
  check('memory_artifact_state', sql`${table.artifactState} IN ('empty','ready','updating','needsRepair','clearing')`),
  check('memory_revisions', sql`${table.controlRevision} >= 0 AND ${table.dirtyRevision} >= ${table.processedRevision} AND ${table.processedRevision} >= 0`),
]);

export const memoryRequests = sqliteTable('memory_requests', {
  operation: text('operation').notNull(),
  requestId: text('request_id').notNull(),
  inputHash: text('input_hash').notNull(),
  resultJson: jsonText('result_json').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
}, table => [primaryKey({ columns: [table.operation, table.requestId] })]);

export const workspaces = sqliteTable(
  'workspaces',
  {
    workspaceId: text('workspace_id').primaryKey(),
    name: text('name').notNull(),
    rootPath: text('root_path').notNull(),
    rootPathKey: text('root_path_key').notNull().unique(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastOpenedAt: text('last_opened_at').notNull(),
  },
  (table) => [index('idx_workspaces_last_opened_at').on(table.lastOpenedAt)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    modelSelection: text('model_selection'),
    sessionId: text('session_id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.workspaceId),
    title: text('title').notNull(),
    status: text('status').notNull(),
    activeEntryId: text('active_entry_id'),
    contentUpdatedAt: text('content_updated_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (table) => [
    index('idx_sessions_workspace_updated').on(table.workspaceId, table.updatedAt),
    index('idx_sessions_active_entry').on(table.activeEntryId),
  ],
);

export const sessionEntries = sqliteTable(
  'session_entries',
  {
    entryId: text('entry_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    parentEntryId: text('parent_entry_id'),
    entryType: text('entry_type'),
    messageId: text('message_id'),
    compactionId: text('compaction_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_session_entries_session_created').on(table.sessionId, table.createdAt),
    index('idx_session_entries_parent').on(table.sessionId, table.parentEntryId),
    index('idx_session_entries_type').on(table.sessionId, table.entryType),
    index('idx_session_entries_message').on(table.sessionId, table.messageId),
    index('idx_session_entries_compaction').on(table.sessionId, table.compactionId),
    uniqueIndex('idx_session_entries_message_identity')
      .on(table.messageId)
      .where(sql`${table.entryType} = 'message' AND ${table.messageId} IS NOT NULL`),
    uniqueIndex('idx_session_entries_compaction_identity')
      .on(table.compactionId)
      .where(sql`${table.entryType} = 'compaction' AND ${table.compactionId} IS NOT NULL`),
  ],
);

export const sessionMessages = sqliteTable(
  'session_messages',
  {
    messageId: text('message_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    executionId: text('execution_id'),
    messageKind: text('message_kind').notNull(),
    messageJson: jsonText('message_json').notNull(),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_session_messages_session_created').on(table.sessionId, table.createdAt),
    index('idx_session_messages_execution').on(table.executionId),
    uniqueIndex('idx_session_messages_assistant_reply_execution')
      .on(table.sessionId, table.executionId)
      .where(sql`${table.messageKind} = 'assistant_reply'`),
  ],
);

export const sessionReplySequence = sqliteTable('session_reply_sequence', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  messageId: text('message_id').notNull().unique()
    .references(() => sessionMessages.messageId, { onDelete: 'cascade' }),
});

export const sessionMessageAttachments = sqliteTable(
  'session_message_attachments',
  {
    attachmentId: text('attachment_id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => sessionMessages.messageId, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    name: text('name'),
    mimeType: text('mime_type'),
    sourceType: text('source_type').notNull(),
    sourceValue: text('source_value').notNull(),
    ordinal: integer('ordinal').notNull(),
    sizeBytes: integer('size_bytes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_session_message_attachments_message').on(table.messageId),
    index('idx_session_message_attachments_session').on(table.sessionId),
    uniqueIndex('idx_session_message_attachments_message_ordinal').on(
      table.messageId,
      table.ordinal,
    ),
  ],
);

export const sessionCompactions = sqliteTable(
  'session_compactions',
  {
    compactionId: text('compaction_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    anchorEntryId: text('anchor_entry_id').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull(),
    summaryText: text('summary_text'),
    coveredUntilEntryId: text('covered_until_entry_id'),
    firstKeptEntryId: text('first_kept_entry_id'),
    usage: text('usage'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_session_compactions_session_started').on(table.sessionId, table.startedAt),
    index('idx_session_compactions_session_status').on(table.sessionId, table.status),
  ],
);

export const workspaceChanges = sqliteTable(
  'workspace_changes',
  {
    changeSetId: text('change_set_id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.workspaceId),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    executionId: text('execution_id').notNull(),
    status: text('status').notNull(),
    effectCoverage: text('effect_coverage').notNull(),
    changedFileCount: integer('changed_file_count').notNull(),
    createdAt: text('created_at').notNull(),
    finalizedAt: text('finalized_at'),
  },
  (table) => [
    index('idx_workspace_changes_execution').on(table.executionId),
    index('idx_workspace_changes_workspace_created').on(table.workspaceId, table.createdAt),
    uniqueIndex('idx_workspace_changes_scope').on(
      table.workspaceId,
      table.sessionId,
      table.executionId,
    ),
  ],
);

export const workspaceChangedFiles = sqliteTable(
  'workspace_changed_files',
  {
    changedFileId: text('changed_file_id').primaryKey(),
    changeSetId: text('change_set_id')
      .notNull()
      .references(() => workspaceChanges.changeSetId, { onDelete: 'cascade' }),
    workspacePath: text('workspace_path').notNull(),
    changeKind: text('change_kind').notNull(),
    effectType: text('effect_type').notNull(),
    sourceWorkspacePath: text('source_workspace_path'),
    destinationWorkspacePath: text('destination_workspace_path'),
    pathType: text('path_type').notNull(),
    recoverable: integer('recoverable'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_workspace_changed_files_change').on(table.changeSetId),
    uniqueIndex('idx_workspace_changed_files_change_path').on(
      table.changeSetId,
      table.workspacePath,
    ),
  ],
);

export const skillAvailability = sqliteTable(
  'skill_availability',
  {
    skillAvailabilityId: text('skill_availability_id').primaryKey(),
    skillPath: text('skill_path').notNull(),
    available: integer('available').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_skill_availability_path').on(table.skillPath)],
);

/*
 * Candidate Supply tables. Unlike the session tables, these store UTC
 * millisecond integers and JSON columns as validated text, as the supply Spec
 * requires. Discovery and result consumers share acquired material through owner contracts.
 */

export const interests = sqliteTable('interests', {
    id: text('id').primaryKey().notNull(),
    text: text('text').notNull(),
    enabled: integer('enabled').notNull().default(sql.raw("true")),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    revision: integer('revision').notNull().default(sql.raw("1")),
}, (table): SQLiteTableExtraConfigValue[] => [
  check('check_interests_1',sql.raw("length(trim(\"interests\".\"text\")) > 0")),
]);

export const contents = sqliteTable('contents', {
    id: text('id').primaryKey().notNull(),
    platform: text('platform').notNull(),
    externalId: text('external_id'),
    canonicalUrl: text('canonical_url').notNull(),
    title: text('title'),
    author: text('author'),
    authorId: text('author_id'),
    language: text('language'),
    currentMaterialId: text('current_material_id'),
    duplicateGroupId: text('duplicate_group_id').references((): AnySQLiteColumn => contents.id, {onDelete:'set null'}),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  foreignKey({columns:[table.currentMaterialId,table.id],foreignColumns:[contentMaterials.id,contentMaterials.contentId]}).onDelete('restrict'),
  uniqueIndex('idx_contents_platform_external').on(table.platform,table.externalId).where(sql.raw("external_id IS NOT NULL AND external_id <> ''")),
  unique('contents_canonical_url_unique').on(table.canonicalUrl),
]);

export const contentMaterials = sqliteTable('content_materials', {
    id: text('id').primaryKey().notNull(),
    contentId: text('content_id').notNull().references((): AnySQLiteColumn => contents.id, {onDelete:'cascade'}),
    revision: integer('revision').notNull(),
    title: text('title'),
    author: text('author'),
    authorId: text('author_id'),
    language: text('language'),
    text: text('text').notNull(),
    textHash: text('text_hash').notNull(),
    kind: text('kind').notNull(),
    truncated: integer('truncated').notNull(),
    rangeStart: integer('range_start').notNull().default(sql.raw("0")),
    rangeEnd: integer('range_end').notNull(),
    method: text('method').notNull(),
    acquiredAt: integer('acquired_at').notNull(),
    publicationEvidence: text('publication_evidence').notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  unique('content_materials_id_content_id_unique').on(table.id,table.contentId),
  unique('content_materials_content_id_revision_unique').on(table.contentId,table.revision),
  check('check_content_materials_1',sql.raw("revision > 0")),
  check('check_content_materials_2',sql.raw("length(text) > 0")),
  check('check_content_materials_3',sql.raw("kind IN ('full_text','excerpt','description','transcript')")),
  check('check_content_materials_4',sql.raw("truncated IN (0,1)")),
  check('check_content_materials_5',sql.raw("range_start >= 0")),
  check('check_content_materials_6',sql.raw("range_end > range_start")),
  check('check_content_materials_7',sql.raw("json_valid(publication_evidence)")),
]);

export const materialAcquisitions = sqliteTable('material_acquisitions', {
    id: text('id').primaryKey().notNull(),
    materialId: text('material_id').notNull().references((): AnySQLiteColumn => contentMaterials.id, {onDelete:'cascade'}),
    method: text('method').notNull(),
    acquiredAt: integer('acquired_at').notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [

]);

export const discoveryRuns = sqliteTable('discovery_runs', {
    id: text('id').primaryKey().notNull(),
    purpose: text('purpose').notNull(),
    status: text('status').notNull(),
    interestSnapshot: text('interest_snapshot').notNull(),
    configRevision: text('config_revision').notNull(),
    acceptedPlan: text('accepted_plan'),
    nextStep: text('next_step'),
    yieldSummary: text('yield_summary'),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    budget: text('budget').notNull(),
    issues: text('issues').notNull().default(sql.raw("'[]'")),
}, (table): SQLiteTableExtraConfigValue[] => [
  check('check_discovery_runs_1',sql.raw("purpose IN ('daily_feed','candidate_supply')")),
  check('check_discovery_runs_2',sql.raw("status IN ('running','completed','partial','failed','cancelled','interrupted')")),
  check('check_discovery_runs_3',sql.raw("json_valid(interest_snapshot)")),
  check('check_discovery_runs_4',sql.raw("accepted_plan IS NULL OR json_valid(accepted_plan)")),
  check('check_discovery_runs_5',sql.raw("yield_summary IS NULL OR json_valid(yield_summary)")),
  check('check_discovery_runs_6',sql.raw("json_valid(budget)")),
  check('check_discovery_runs_7',sql.raw("json_valid(issues)")),
]);

export const materialRequests = sqliteTable('material_requests', {
    ownerRunId: text('owner_run_id').references((): AnySQLiteColumn => discoveryRuns.id, {onDelete:'restrict'}),
    attemptToken: text('attempt_token'),
    attemptStartedAt: integer('attempt_started_at'),
    attemptDeadlineAt: integer('attempt_deadline_at'),
    id: text('id').primaryKey().notNull(),
    contentId: text('content_id').notNull().references((): AnySQLiteColumn => contents.id, {onDelete:'cascade'}),
    discoveryRunId: text('discovery_run_id').references((): AnySQLiteColumn => discoveryRuns.id, {onDelete:'no action'}),
    method: text('method').notNull(),
    requestUrl: text('request_url').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(sql.raw("0")),
    retryAt: integer('retry_at'),
    errorCode: text('error_code'),
}, (table): SQLiteTableExtraConfigValue[] => [
  index('idx_material_requests_status_retry').on(table.status,table.retryAt),
  uniqueIndex('idx_material_requests_active').on(table.contentId,table.method).where(sql.raw("status IN ('pending','running')")),
  check('check_material_requests_1',sql.raw("status IN ('pending','running','ready','failed','cancelled')")),
  check('check_material_requests_2',sql.raw("attempts >= 0")),
  check('check_material_requests_3',sql.raw("(owner_run_id IS NULL AND attempt_token IS NULL AND attempt_started_at IS NULL AND attempt_deadline_at IS NULL) OR (owner_run_id IS NOT NULL AND attempt_token IS NOT NULL AND attempt_started_at IS NOT NULL AND attempt_deadline_at > attempt_started_at)")),
]);

export const contentAnalysis = sqliteTable('content_analysis', {
    ownerRunId: text('owner_run_id').references((): AnySQLiteColumn => discoveryRuns.id, {onDelete:'restrict'}),
    attemptToken: text('attempt_token'),
    attemptStartedAt: integer('attempt_started_at'),
    attemptDeadlineAt: integer('attempt_deadline_at'),
    contentId: text('content_id').notNull(),
    materialId: text('material_id').notNull(),
    contractVersion: integer('contract_version').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(sql.raw("0")),
    retryAt: integer('retry_at'),
    result: text('result'),
    analyzedAt: integer('analyzed_at'),
    errorCode: text('error_code'),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({columns:[table.contentId,table.materialId,table.contractVersion]}),
  foreignKey({columns:[table.materialId,table.contentId],foreignColumns:[contentMaterials.id,contentMaterials.contentId]}).onDelete('cascade'),
  index('idx_content_analysis_status_retry').on(table.status,table.retryAt),
  check('check_content_analysis_1',sql.raw("contract_version > 0")),
  check('check_content_analysis_2',sql.raw("status IN ('pending','running','ready','failed','cancelled')")),
  check('check_content_analysis_3',sql.raw("attempts >= 0")),
  check('check_content_analysis_4',sql.raw("result IS NULL OR json_valid(result)")),
  check('check_content_analysis_5',sql.raw("(owner_run_id IS NULL AND attempt_token IS NULL AND attempt_started_at IS NULL AND attempt_deadline_at IS NULL) OR (owner_run_id IS NOT NULL AND attempt_token IS NOT NULL AND attempt_started_at IS NOT NULL AND attempt_deadline_at > attempt_started_at)")),
]);

export const recommendationCandidates = sqliteTable('recommendation_candidates', {
    ownerRunId: text('owner_run_id').references((): AnySQLiteColumn => discoveryRuns.id, {onDelete:'restrict'}),
    attemptToken: text('attempt_token'),
    attemptStartedAt: integer('attempt_started_at'),
    attemptDeadlineAt: integer('attempt_deadline_at'),
    contentId: text('content_id').notNull().references((): AnySQLiteColumn => contents.id, {onDelete:'cascade'}),
    interestId: text('interest_id').notNull().references((): AnySQLiteColumn => interests.id, {onDelete:'cascade'}),
    interestRevision: integer('interest_revision').notNull(),
    materialId: text('material_id').notNull(),
    analysisContractVersion: integer('analysis_contract_version').notNull(),
    matchingContractVersion: integer('matching_contract_version').notNull(),
    relation: text('relation').notNull(),
    status: text('status').notNull(),
    basis: text('basis'),
    evidence: text('evidence').notNull().default(sql.raw("'[]'")),
    reviewedAt: integer('reviewed_at'),
    validUntil: integer('valid_until'),
    attempts: integer('attempts').notNull().default(sql.raw("0")),
    retryAt: integer('retry_at'),
    errorCode: text('error_code'),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({columns:[table.contentId,table.interestId]}),
  foreignKey({columns:[table.contentId,table.materialId,table.analysisContractVersion],foreignColumns:[contentAnalysis.contentId,contentAnalysis.materialId,contentAnalysis.contractVersion]}).onDelete('cascade'),
  foreignKey({columns:[table.materialId,table.contentId],foreignColumns:[contentMaterials.id,contentMaterials.contentId]}).onDelete('cascade'),
  index('idx_recommendation_candidates_status_retry').on(table.status,table.retryAt),
  index('idx_candidates_current').on(table.interestId,table.interestRevision,table.status,table.validUntil),
  check('check_recommendation_candidates_1',sql.raw("interest_revision > 0")),
  check('check_recommendation_candidates_2',sql.raw("relation IN ('direct','related','none')")),
  check('check_recommendation_candidates_3',sql.raw("status IN ('eligible','rejected','pending','stale')")),
  check('check_recommendation_candidates_4',sql.raw("json_valid(evidence)")),
  check('check_recommendation_candidates_5',sql.raw("attempts >= 0")),
  check('check_recommendation_candidates_6',sql.raw("(owner_run_id IS NULL AND attempt_token IS NULL AND attempt_started_at IS NULL AND attempt_deadline_at IS NULL) OR (owner_run_id IS NOT NULL AND attempt_token IS NOT NULL AND attempt_started_at IS NOT NULL AND attempt_deadline_at > attempt_started_at)")),
]);

export const candidateSelectionInputs = sqliteTable('candidate_selection_inputs', {
    runId: text('run_id').notNull().references((): AnySQLiteColumn => recommendationRuns.id, {onDelete:'cascade'}),
    contentId: text('content_id').notNull().references((): AnySQLiteColumn => contents.id, {onDelete:'cascade'}),
    interestId: text('interest_id').notNull().references((): AnySQLiteColumn => interests.id, {onDelete:'cascade'}),
    interestRevision: integer('interest_revision').notNull(),
    recordedAt: integer('recorded_at').notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({columns:[table.runId,table.contentId,table.interestId]}),
]);

export const searchQueries = sqliteTable('search_queries', {
    id: text('id').primaryKey().notNull(),
    interestId: text('interest_id').references((): AnySQLiteColumn => interests.id, {onDelete:'set null'}),
    interestRevision: integer('interest_revision').notNull(),
    query: text('query').notNull(),
    category: text('category').notNull(),
    origin: text('origin').notNull(),
    status: text('status').notNull(),
    lastUsedAt: integer('last_used_at'),
    createdAt: integer('created_at').notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('idx_search_queries_active_identity').on(table.interestId,table.interestRevision,table.query).where(sql.raw("status = 'active'")),
  check('check_search_queries_1',sql.raw("length(query) BETWEEN 1 AND 200")),
  check('check_search_queries_2',sql.raw("category IN ('core','entity','technical','exploratory','trend')")),
  check('check_search_queries_3',sql.raw("origin IN ('ai','interest')")),
  check('check_search_queries_4',sql.raw("status IN ('active','retired')")),
]);

export const searchHistory = sqliteTable('search_history', {
    id: text('id').primaryKey().notNull(),
    queryId: text('query_id').notNull().references((): AnySQLiteColumn => searchQueries.id, {onDelete:'no action'}),
    sourceId: text('source_id').notNull(),
    searchScope: text('search_scope').notNull(),
    searchedAt: integer('searched_at').notNull(),
    outcome: text('outcome').notNull(),
    resultCount: integer('result_count'),
    newItemCount: integer('new_item_count'),
    runId: text('run_id').references((): AnySQLiteColumn => discoveryRuns.id, {onDelete:'no action'}),
    purpose: text('purpose').notNull(),
    windowStart: integer('window_start'),
    windowEnd: integer('window_end'),
    errorCode: text('error_code'),
}, (table): SQLiteTableExtraConfigValue[] => [
  index('idx_search_history_source_purpose_query_date').on(table.sourceId,table.purpose,table.queryId,table.searchedAt),
  check('check_search_history_1',sql.raw("json_valid(search_scope)")),
  check('check_search_history_2',sql.raw("outcome IN ('success','failed')")),
  check('check_search_history_3',sql.raw("purpose IN ('legacy','daily_feed','candidate_supply')")),
]);

export const searchResults = sqliteTable('search_results', {
    id: text('id').primaryKey().notNull(),
    platform: text('platform').notNull(),
    sourceId: text('source_id').notNull(),
    externalId: text('external_id'),
    requestUrl: text('request_url').notNull(),
    title: text('title'),
    excerpt: text('excerpt'),
    author: text('author'),
    publicationEvidence: text('publication_evidence').notNull(),
    rawPayload: text('raw_payload'),
    contentId: text('content_id').references((): AnySQLiteColumn => contents.id, {onDelete:'set null'}),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(sql.raw("0")),
    retryAt: integer('retry_at'),
    errorCode: text('error_code'),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  index('idx_search_results_status_retry').on(table.status,table.retryAt),
  uniqueIndex('idx_search_results_external').on(table.platform,table.externalId).where(sql.raw("external_id IS NOT NULL AND external_id <> ''")),
  unique('search_results_platform_request_url_unique').on(table.platform,table.requestUrl),
  check('check_search_results_1',sql.raw("json_valid(publication_evidence)")),
  check('check_search_results_2',sql.raw("status IN ('pending','normalized','rejected','failed')")),
]);

export const searchResultLinks = sqliteTable('search_result_links', {
    searchHistoryId: text('search_history_id').notNull().references((): AnySQLiteColumn => searchHistory.id, {onDelete:'cascade'}),
    searchResultId: text('search_result_id').notNull().references((): AnySQLiteColumn => searchResults.id, {onDelete:'cascade'}),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({columns:[table.searchHistoryId,table.searchResultId]}),
]);

export const dailyFeedBatches = sqliteTable('daily_feed_batches', {
    id: text('id').primaryKey().notNull(),
    date: text('date').notNull(),
    timezone: text('timezone').notNull(),
    interestId: text('interest_id').notNull(),
    interestRevision: integer('interest_revision').notNull(),
    interestText: text('interest_text').notNull(),
    windowStart: integer('window_start').notNull(),
    windowEnd: integer('window_end').notNull(),
    status: text('status').notNull(),
    committedAt: integer('committed_at').notNull(),
    issues: text('issues').notNull().default(sql.raw("'[]'")),
}, (table): SQLiteTableExtraConfigValue[] => [
  index('idx_daily_feed_date_interest').on(table.date,table.interestId,table.interestRevision),
  unique('daily_feed_batches_date_interest_id_interest_revision_unique').on(table.date,table.interestId,table.interestRevision),
  check('check_daily_feed_batches_1',sql.raw("window_end > window_start")),
  check('check_daily_feed_batches_2',sql.raw("status IN ('ready','partial','empty','failed')")),
  check('check_daily_feed_batches_3',sql.raw("json_valid(issues)")),
]);

export const dailyFeedItems = sqliteTable('daily_feed_items', {
    batchId: text('batch_id').notNull().references((): AnySQLiteColumn => dailyFeedBatches.id, {onDelete:'cascade'}),
    contentId: text('content_id').notNull().references((): AnySQLiteColumn => contents.id, {onDelete:'restrict'}),
    materialId: text('material_id').notNull(),
    displayOrder: integer('display_order').notNull(),
    titleSnapshot: text('title_snapshot').notNull(),
    summarySnapshot: text('summary_snapshot').notNull(),
    publicationSnapshot: text('publication_snapshot').notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({columns:[table.batchId,table.contentId]}),
  foreignKey({columns:[table.materialId,table.contentId],foreignColumns:[contentMaterials.id,contentMaterials.contentId]}).onDelete('restrict'),
  unique('daily_feed_items_batch_id_display_order_unique').on(table.batchId,table.displayOrder),
  check('check_daily_feed_items_1',sql.raw("json_valid(publication_snapshot)")),
]);

export const curatedSelections = sqliteTable('curated_selections', {
    id: text('id').primaryKey().notNull(),
    interestSnapshot: text('interest_snapshot').notNull(),
    createdAt: integer('created_at').notNull(),
    status: text('status').notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  check('check_curated_selections_1',sql.raw("json_valid(interest_snapshot)")),
  check('check_curated_selections_2',sql.raw("status IN ('ready','retired')")),
]);

export const curatedSelectionItems = sqliteTable('curated_selection_items', {
    selectionId: text('selection_id').notNull().references((): AnySQLiteColumn => curatedSelections.id, {onDelete:'cascade'}),
    contentId: text('content_id').notNull().references((): AnySQLiteColumn => contents.id, {onDelete:'restrict'}),
    materialId: text('material_id').notNull(),
    displayOrder: integer('display_order').notNull(),
    matchedInterests: text('matched_interests').notNull(),
    reason: text('reason').notNull(),
    evidence: text('evidence').notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({columns:[table.selectionId,table.contentId]}),
  foreignKey({columns:[table.materialId,table.contentId],foreignColumns:[contentMaterials.id,contentMaterials.contentId]}).onDelete('restrict'),
  unique('curated_selection_items_selection_id_display_order_unique').on(table.selectionId,table.displayOrder),
  check('check_curated_selection_items_1',sql.raw("json_valid(matched_interests)")),
  check('check_curated_selection_items_2',sql.raw("json_valid(evidence)")),
]);

export const favorites = sqliteTable('favorites', {
    contentId: text('content_id').primaryKey().references((): AnySQLiteColumn => contents.id, {onDelete:'restrict'}),
    materialId: text('material_id').notNull(),
    titleSnapshot: text('title_snapshot').notNull(),
    createdAt: integer('created_at').notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  foreignKey({columns:[table.materialId,table.contentId],foreignColumns:[contentMaterials.id,contentMaterials.contentId]}).onDelete('restrict'),
  index('idx_favorites_created').on(table.createdAt,table.contentId),
]);

export const recommendationRuns = sqliteTable('recommendation_runs', {
    id: text('id').primaryKey().notNull(),
    kind: text('kind').notNull(),
    requestId: text('request_id').notNull(),
    retryOfRunId: text('retry_of_run_id').references((): AnySQLiteColumn => recommendationRuns.id, {onDelete:'no action'}),
    inputHash: text('input_hash').notNull(),
    status: text('status').notNull(),
    interestSnapshot: text('interest_snapshot').notNull(),
    candidateSnapshot: text('candidate_snapshot').notNull(),
    dailyFeedBatchId: text('daily_feed_batch_id').references((): AnySQLiteColumn => dailyFeedBatches.id, {onDelete:'restrict'}),
    curatedSelectionId: text('curated_selection_id').references((): AnySQLiteColumn => curatedSelections.id, {onDelete:'restrict'}),
    outcome: text('outcome'),
    error: text('error'),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
}, (table): SQLiteTableExtraConfigValue[] => [
  unique('recommendation_runs_request_id_unique').on(table.requestId),
  check('check_recommendation_runs_1',sql.raw("kind IN ('daily_feed','curated')")),
  check('check_recommendation_runs_2',sql.raw("status IN ('queued','running','completed','partial','empty','failed','cancelled','interrupted','superseded')")),
  check('check_recommendation_runs_3',sql.raw("json_valid(interest_snapshot)")),
  check('check_recommendation_runs_4',sql.raw("json_valid(candidate_snapshot)")),
  check('check_recommendation_runs_5',sql.raw("outcome IS NULL OR json_valid(outcome)")),
  check('check_recommendation_runs_6',sql.raw("error IS NULL OR json_valid(error)")),
  check('check_recommendation_runs_7',sql.raw("(daily_feed_batch_id IS NULL OR kind = 'daily_feed') AND (curated_selection_id IS NULL OR kind = 'curated')")),
]);

export const recommendationRunJudgments = sqliteTable('recommendation_run_judgments', {
    ownerRunId: text('owner_run_id').references((): AnySQLiteColumn => recommendationRuns.id, {onDelete:'restrict'}),
    attemptToken: text('attempt_token'),
    attemptStartedAt: integer('attempt_started_at'),
    attemptDeadlineAt: integer('attempt_deadline_at'),
    runId: text('run_id').notNull().references((): AnySQLiteColumn => recommendationRuns.id, {onDelete:'cascade'}),
    stage: text('stage').notNull(),
    contentId: text('content_id').notNull(),
    interestId: text('interest_id').notNull(),
    materialId: text('material_id').notNull(),
    inputHash: text('input_hash').notNull(),
    status: text('status').notNull(),
    result: text('result'),
    attempts: integer('attempts').notNull().default(sql.raw("0")),
    retryAt: integer('retry_at'),
    errorCode: text('error_code'),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({columns:[table.runId,table.stage,table.contentId,table.interestId]}),
  foreignKey({columns:[table.materialId,table.contentId],foreignColumns:[contentMaterials.id,contentMaterials.contentId]}).onDelete('restrict'),
  index('idx_recommendation_run_judgments_status_retry').on(table.status,table.retryAt),
  check('check_recommendation_run_judgments_1',sql.raw("stage IN ('topic','date','value')")),
  check('check_recommendation_run_judgments_2',sql.raw("status IN ('pending','running','ready','failed','cancelled')")),
  check('check_recommendation_run_judgments_3',sql.raw("result IS NULL OR json_valid(result)")),
  check('check_recommendation_run_judgments_4',sql.raw("(owner_run_id IS NULL AND attempt_token IS NULL AND attempt_started_at IS NULL AND attempt_deadline_at IS NULL) OR (owner_run_id IS NOT NULL AND attempt_token IS NOT NULL AND attempt_started_at IS NOT NULL AND attempt_deadline_at > attempt_started_at)")),
]);

export const recommendationState = sqliteTable('recommendation_state', {
    id: integer('id').primaryKey(),
    currentSelectionId: text('current_selection_id').references((): AnySQLiteColumn => curatedSelections.id, {onDelete:'restrict'}),
    pendingInitialInterestHash: text('pending_initial_interest_hash'),
    finishedAutomaticInterestHash: text('finished_automatic_interest_hash'),
    automaticRetryCount: integer('automatic_retry_count').notNull().default(sql.raw("0")),
    nextRetryAt: integer('next_retry_at'),
}, (table): SQLiteTableExtraConfigValue[] => [
  check('check_recommendation_state_1',sql.raw("id = 1")),
]);

export const candidateSupplyState = sqliteTable('candidate_supply_state', {
    id: integer('id').primaryKey(),
    sourceCooldowns: text('source_cooldowns').notNull(),
    searchBackoff: text('search_backoff').notNull(),
    supplementRequests: text('supplement_requests').notNull().default(sql.raw("'[]'")),
    candidateNextInterestId: text('candidate_next_interest_id'),
    dailyFeedNextInterestId: text('daily_feed_next_interest_id'),
    lastFinishedAt: integer('last_finished_at'),
}, (table): SQLiteTableExtraConfigValue[] => [
  check('check_candidate_supply_state_1',sql.raw("id = 1")),
  check('check_candidate_supply_state_2',sql.raw("json_valid(source_cooldowns)")),
  check('check_candidate_supply_state_3',sql.raw("json_valid(search_backoff)")),
  check('check_candidate_supply_state_4',sql.raw("json_valid(supplement_requests)")),
]);
