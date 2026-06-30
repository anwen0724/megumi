// Drizzle schema source-of-truth for Coding Agent product persistence.
import { sql } from 'drizzle-orm';
import { type AnySQLiteColumn, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];
type JsonValue = JsonObject | JsonArray | string | number | boolean | null;

const jsonText = (name: string) => text(name, { mode: 'json' }).$type<JsonValue>();

// Cyclic SQLite foreign keys are declared in the initial SQL migration.
// Keeping those cycles out of inline Drizzle references avoids TypeScript
// self-initializer inference failures while preserving runtime constraints.

export const workspaces = sqliteTable('workspaces', {
  workspaceId: text('workspace_id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull(),
  rootPathKey: text('root_path_key').notNull().unique(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastOpenedAt: text('last_opened_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_workspaces_last_opened_at').on(table.lastOpenedAt),
]);

export const sessions = sqliteTable('sessions', {
  sessionId: text('session_id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.workspaceId, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').notNull(),
  activeEntryId: text('active_entry_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  archivedAt: text('archived_at'),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_sessions_workspace_updated').on(table.workspaceId, table.updatedAt),
  index('idx_sessions_active_entry').on(table.activeEntryId),
]);

export const sessionEntries = sqliteTable('session_entries', {
  entryId: text('entry_id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  parentEntryId: text('parent_entry_id'),
  entryKind: text('entry_kind').notNull(),
  messageId: text('message_id'),
  compactionId: text('compaction_id'),
  targetEntryId: text('target_entry_id'),
  createdAt: text('created_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_session_entries_session_created').on(table.sessionId, table.createdAt),
  index('idx_session_entries_parent').on(table.sessionId, table.parentEntryId),
  index('idx_session_entries_kind').on(table.sessionId, table.entryKind),
  index('idx_session_entries_message').on(table.sessionId, table.messageId),
  index('idx_session_entries_compaction').on(table.sessionId, table.compactionId),
]);

export const sessionLeafChanges = sqliteTable('session_leaf_changes', {
  leafChangeId: text('leaf_change_id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  previousEntryId: text('previous_entry_id').references(() => sessionEntries.entryId, { onDelete: 'set null' }),
  nextEntryId: text('next_entry_id').references(() => sessionEntries.entryId, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_session_leaf_changes_session_created').on(table.sessionId, table.createdAt),
]);

export const sessionMessages = sqliteTable('session_messages', {
  messageId: text('message_id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  runId: text('run_id'),
  role: text('role').notNull(),
  status: text('status').notNull(),
  contentText: text('content_text').notNull(),
  blocksJson: jsonText('blocks_json'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_session_messages_session_created').on(table.sessionId, table.createdAt),
  index('idx_session_messages_run').on(table.runId),
]);

export const sessionCompactions = sqliteTable('session_compactions', {
  compactionId: text('compaction_id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  summaryText: text('summary_text').notNull(),
  coveredUntilEntryId: text('covered_until_entry_id'),
  firstKeptEntryId: text('first_kept_entry_id'),
  tokenCountBefore: integer('token_count_before'),
  tokenCountAfter: integer('token_count_after'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
  errorJson: jsonText('error_json'),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_session_compactions_session_created').on(table.sessionId, table.createdAt),
  index('idx_session_compactions_session_status').on(table.sessionId, table.status),
]);

export const agentLoopRuns = sqliteTable('agent_loop_runs', {
  runId: text('run_id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.workspaceId, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  runKind: text('run_kind').notNull(),
  userMessageId: text('user_message_id').references(() => sessionMessages.messageId, { onDelete: 'set null' }),
  assistantMessageId: text('assistant_message_id').references(() => sessionMessages.messageId, { onDelete: 'set null' }),
  baseRunId: text('base_run_id').references((): AnySQLiteColumn => agentLoopRuns.runId, { onDelete: 'set null' }),
  baseMessageId: text('base_message_id').references(() => sessionMessages.messageId, { onDelete: 'set null' }),
  baseEntryId: text('base_entry_id').references(() => sessionEntries.entryId, { onDelete: 'set null' }),
  attemptNumber: integer('attempt_number').notNull(),
  status: text('status').notNull(),
  permissionMode: text('permission_mode').notNull(),
  permissionSnapshotJson: jsonText('permission_snapshot_json'),
  memoryRecallTraceId: text('memory_recall_trace_id'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  cancelledAt: text('cancelled_at'),
  errorJson: jsonText('error_json'),
  createdAt: text('created_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_agent_loop_runs_session_created').on(table.sessionId, table.createdAt),
  index('idx_agent_loop_runs_workspace_created').on(table.workspaceId, table.createdAt),
  index('idx_agent_loop_runs_status').on(table.status),
  index('idx_agent_loop_runs_user_message').on(table.userMessageId),
  index('idx_agent_loop_runs_assistant_message').on(table.assistantMessageId),
  index('idx_agent_loop_runs_base_run').on(table.baseRunId),
  index('idx_agent_loop_runs_base_entry').on(table.baseEntryId),
]);

export const modelCalls = sqliteTable('model_calls', {
  modelCallId: text('model_call_id').primaryKey(),
  runId: text('run_id').notNull().references(() => agentLoopRuns.runId, { onDelete: 'cascade' }),
  callOrder: integer('call_order').notNull(),
  providerId: text('provider_id').notNull(),
  modelId: text('model_id').notNull(),
  status: text('status').notNull(),
  inputSummaryJson: jsonText('input_summary_json'),
  contextSnapshotJson: jsonText('context_snapshot_json'),
  requestJson: jsonText('request_json'),
  responseJson: jsonText('response_json'),
  outputSummaryJson: jsonText('output_summary_json'),
  tokenUsageJson: jsonText('token_usage_json'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  errorJson: jsonText('error_json'),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  uniqueIndex('idx_model_calls_run_order').on(table.runId, table.callOrder),
]);

export const toolSources = sqliteTable('tool_sources', {
  toolSourceId: text('tool_source_id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.workspaceId, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  configJson: jsonText('config_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_tool_sources_workspace_type_name').on(table.workspaceId, table.sourceType, table.name),
]);

export const toolRegistrySnapshots = sqliteTable('tool_registry_snapshots', {
  snapshotId: text('snapshot_id').primaryKey(),
  runId: text('run_id').notNull().references(() => agentLoopRuns.runId, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references(() => workspaces.workspaceId, { onDelete: 'cascade' }),
  toolCount: integer('tool_count').notNull(),
  snapshotJson: jsonText('snapshot_json').notNull(),
  createdAt: text('created_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_tool_registry_snapshots_run').on(table.runId),
]);

export const toolCalls = sqliteTable('tool_calls', {
  toolCallId: text('tool_call_id').primaryKey(),
  runId: text('run_id').notNull().references(() => agentLoopRuns.runId, { onDelete: 'cascade' }),
  modelCallId: text('model_call_id').notNull().references(() => modelCalls.modelCallId, { onDelete: 'cascade' }),
  callOrder: integer('call_order').notNull(),
  providerToolCallId: text('provider_tool_call_id'),
  toolSourceId: text('tool_source_id').references(() => toolSources.toolSourceId, { onDelete: 'set null' }),
  toolName: text('tool_name').notNull(),
  modelVisibleName: text('model_visible_name').notNull(),
  inputJson: jsonText('input_json').notNull(),
  inputPreview: text('input_preview'),
  status: text('status').notNull(),
  permissionDecisionJson: jsonText('permission_decision_json'),
  approvalRequestId: text('approval_request_id'),
  resultJson: jsonText('result_json'),
  resultPreview: text('result_preview'),
  observationJson: jsonText('observation_json'),
  submittedToModelAt: text('submitted_to_model_at'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  errorJson: jsonText('error_json'),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_tool_calls_run_order').on(table.runId, table.callOrder),
  index('idx_tool_calls_model_order').on(table.modelCallId, table.callOrder),
  index('idx_tool_calls_status').on(table.status),
]);

export const approvalRequests = sqliteTable('approval_requests', {
  approvalRequestId: text('approval_request_id').primaryKey(),
  runId: text('run_id').notNull().references(() => agentLoopRuns.runId, { onDelete: 'cascade' }),
  toolCallId: text('tool_call_id').notNull().references(() => toolCalls.toolCallId, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  requestedScope: text('requested_scope').notNull(),
  riskLevel: text('risk_level').notNull(),
  requestJson: jsonText('request_json').notNull(),
  decision: text('decision'),
  decidedBy: text('decided_by'),
  decidedAt: text('decided_at'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at'),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_approval_requests_run_status').on(table.runId, table.status),
  index('idx_approval_requests_tool_call').on(table.toolCallId),
]);

export const workspaceChanges = sqliteTable('workspace_changes', {
  changeId: text('change_id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.workspaceId, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  runId: text('run_id').notNull().references(() => agentLoopRuns.runId, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  changedFileCount: integer('changed_file_count').notNull(),
  createdAt: text('created_at').notNull(),
  finalizedAt: text('finalized_at'),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_workspace_changes_run').on(table.runId),
  index('idx_workspace_changes_workspace_created').on(table.workspaceId, table.createdAt),
]);

export const workspaceFileSnapshots = sqliteTable('workspace_file_snapshots', {
  snapshotId: text('snapshot_id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.workspaceId, { onDelete: 'cascade' }),
  runId: text('run_id').references(() => agentLoopRuns.runId, { onDelete: 'set null' }),
  path: text('path').notNull(),
  storage: text('storage').notNull(),
  encoding: text('encoding').notNull(),
  sha256: text('sha256').notNull(),
  byteLength: integer('byte_length').notNull(),
  contentText: text('content_text'),
  contentRef: text('content_ref'),
  createdAt: text('created_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_workspace_file_snapshots_lookup').on(table.workspaceId, table.path, table.sha256),
]);

export const workspaceChangedFiles = sqliteTable('workspace_changed_files', {
  changedFileId: text('changed_file_id').primaryKey(),
  changeId: text('change_id').notNull().references(() => workspaceChanges.changeId, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  changeKind: text('change_kind').notNull(),
  restoreState: text('restore_state').notNull(),
  beforeExists: integer('before_exists', { mode: 'boolean' }).notNull(),
  beforeSnapshotId: text('before_snapshot_id').references(() => workspaceFileSnapshots.snapshotId, { onDelete: 'set null' }),
  beforeHash: text('before_hash'),
  afterExists: integer('after_exists', { mode: 'boolean' }).notNull(),
  afterSnapshotId: text('after_snapshot_id').references(() => workspaceFileSnapshots.snapshotId, { onDelete: 'set null' }),
  afterHash: text('after_hash'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_workspace_changed_files_change').on(table.changeId),
  index('idx_workspace_changed_files_restore_state').on(table.restoreState),
]);

export const workspaceRestoreOperations = sqliteTable('workspace_restore_operations', {
  restoreId: text('restore_id').primaryKey(),
  changeId: text('change_id').notNull().references(() => workspaceChanges.changeId, { onDelete: 'cascade' }),
  requestedBy: text('requested_by').notNull(),
  status: text('status').notNull(),
  requestedAt: text('requested_at').notNull(),
  completedAt: text('completed_at'),
  resultJson: jsonText('result_json'),
  errorJson: jsonText('error_json'),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_workspace_restore_operations_change_requested').on(table.changeId, table.requestedAt),
]);

export const workspaceRestoreFileResults = sqliteTable('workspace_restore_file_results', {
  fileResultId: text('file_result_id').primaryKey(),
  restoreId: text('restore_id').notNull().references(() => workspaceRestoreOperations.restoreId, { onDelete: 'cascade' }),
  changedFileId: text('changed_file_id').notNull().references(() => workspaceChangedFiles.changedFileId, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  status: text('status').notNull(),
  conflictReason: text('conflict_reason'),
  errorJson: jsonText('error_json'),
  restoredAt: text('restored_at'),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_workspace_restore_file_results_restore').on(table.restoreId),
]);

export const memoryRecords = sqliteTable('memory_records', {
  memoryId: text('memory_id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.workspaceId, { onDelete: 'set null' }),
  sessionId: text('session_id').references(() => sessions.sessionId, { onDelete: 'set null' }),
  scope: text('scope').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  content: text('content').notNull(),
  normalizedText: text('normalized_text').notNull(),
  summary: text('summary'),
  confidence: real('confidence'),
  sourceJson: jsonText('source_json'),
  evidenceJson: jsonText('evidence_json'),
  dedupeKey: text('dedupe_key'),
  supersededById: text('superseded_by_id').references((): AnySQLiteColumn => memoryRecords.memoryId, {
    onDelete: 'set null',
  }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastUsedAt: text('last_used_at'),
  useCount: integer('use_count').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_memory_records_scope_workspace_kind_status').on(table.scope, table.workspaceId, table.kind, table.status),
  index('idx_memory_records_last_used_at').on(table.lastUsedAt),
  uniqueIndex('idx_memory_records_dedupe')
    .on(table.scope, table.workspaceId, table.kind, table.dedupeKey)
    .where(sql`${table.status} = 'active'`),
]);

export const memoryMarkdownMirrors = sqliteTable('memory_markdown_mirrors', {
  mirrorId: text('mirror_id').primaryKey(),
  memoryId: text('memory_id').notNull().references(() => memoryRecords.memoryId, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references(() => workspaces.workspaceId, { onDelete: 'set null' }),
  targetPath: text('target_path').notNull(),
  status: text('status').notNull(),
  lastExportedAt: text('last_exported_at'),
  contentHash: text('content_hash'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_memory_markdown_mirrors_memory').on(table.memoryId),
]);

export const artifacts = sqliteTable('artifacts', {
  artifactId: text('artifact_id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.workspaceId, { onDelete: 'set null' }),
  sessionId: text('session_id').references(() => sessions.sessionId, { onDelete: 'set null' }),
  runId: text('run_id').references(() => agentLoopRuns.runId, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  currentVersionId: text('current_version_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_artifacts_session_updated').on(table.sessionId, table.updatedAt),
]);

export const artifactVersions = sqliteTable('artifact_versions', {
  artifactVersionId: text('artifact_version_id').primaryKey(),
  artifactId: text('artifact_id').notNull().references(() => artifacts.artifactId, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  storage: text('storage').notNull(),
  contentType: text('content_type').notNull(),
  contentFormat: text('content_format').notNull(),
  inlineText: text('inline_text'),
  contentKey: text('content_key'),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  sha256: text('sha256'),
  textPreview: text('text_preview'),
  createdByRunId: text('created_by_run_id').references(() => agentLoopRuns.runId, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  uniqueIndex('idx_artifact_versions_artifact_version').on(table.artifactId, table.versionNumber),
]);

export const artifactSourceRefs = sqliteTable('artifact_source_refs', {
  sourceRefId: text('source_ref_id').primaryKey(),
  artifactId: text('artifact_id').notNull().references(() => artifacts.artifactId, { onDelete: 'cascade' }),
  artifactVersionId: text('artifact_version_id').references(() => artifactVersions.artifactVersionId, { onDelete: 'cascade' }),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  excerptPreview: text('excerpt_preview'),
  createdAt: text('created_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_artifact_source_refs_artifact').on(table.artifactId),
]);

export const agentLoopEvents = sqliteTable('agent_loop_events', {
  eventId: text('event_id').primaryKey(),
  runId: text('run_id').notNull().references(() => agentLoopRuns.runId, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  eventType: text('event_type').notNull(),
  visibility: text('visibility').notNull(),
  createdAt: text('created_at').notNull(),
  payloadJson: jsonText('payload_json').notNull(),
  eventJson: jsonText('event_json').notNull(),
}, (table) => [
  uniqueIndex('idx_agent_loop_events_run_sequence').on(table.runId, table.sequence),
]);

export const memoryRecallTraces = sqliteTable('memory_recall_traces', {
  recallTraceId: text('recall_trace_id').primaryKey(),
  runId: text('run_id').notNull().references(() => agentLoopRuns.runId, { onDelete: 'cascade' }),
  modelCallId: text('model_call_id').references(() => modelCalls.modelCallId, { onDelete: 'set null' }),
  workspaceId: text('workspace_id').references(() => workspaces.workspaceId, { onDelete: 'set null' }),
  sessionId: text('session_id').references(() => sessions.sessionId, { onDelete: 'set null' }),
  queryText: text('query_text').notNull(),
  selectedCount: integer('selected_count').notNull(),
  requestJson: jsonText('request_json').notNull(),
  resultsJson: jsonText('results_json').notNull(),
  createdAt: text('created_at').notNull(),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_memory_recall_traces_run').on(table.runId),
]);

export const memoryCaptureAttempts = sqliteTable('memory_capture_attempts', {
  captureAttemptId: text('capture_attempt_id').primaryKey(),
  runId: text('run_id').references(() => agentLoopRuns.runId, { onDelete: 'set null' }),
  workspaceId: text('workspace_id').references(() => workspaces.workspaceId, { onDelete: 'set null' }),
  sessionId: text('session_id').references(() => sessions.sessionId, { onDelete: 'set null' }),
  status: text('status').notNull(),
  triggerKind: text('trigger_kind').notNull(),
  extractedCount: integer('extracted_count').notNull(),
  createdMemoryIdsJson: jsonText('created_memory_ids_json'),
  rawOutputJson: jsonText('raw_output_json'),
  errorJson: jsonText('error_json'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
  metadataJson: jsonText('metadata_json'),
}, (table) => [
  index('idx_memory_capture_attempts_run').on(table.runId),
]);
