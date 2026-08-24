/* Defines the current physical Drizzle schema without owning business queries. */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];
type JsonValue = JsonObject | JsonArray | string | number | boolean | null;

const jsonText = (name: string) => text(name, { mode: 'json' }).$type<JsonValue>();

export const workspaces = sqliteTable('workspaces', {
  workspaceId: text('workspace_id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull(),
  rootPathKey: text('root_path_key').notNull().unique(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastOpenedAt: text('last_opened_at').notNull(),
}, (table) => [
  index('idx_workspaces_last_opened_at').on(table.lastOpenedAt),
]);

export const sessions = sqliteTable('sessions', {
  sessionId: text('session_id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.workspaceId),
  title: text('title').notNull(),
  status: text('status').notNull(),
  activeEntryId: text('active_entry_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  archivedAt: text('archived_at'),
}, (table) => [
  index('idx_sessions_workspace_updated').on(table.workspaceId, table.updatedAt),
  index('idx_sessions_active_entry').on(table.activeEntryId),
]);

export const sessionEntries = sqliteTable('session_entries', {
  entryId: text('entry_id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  parentEntryId: text('parent_entry_id'),
  entryType: text('entry_type'),
  messageId: text('message_id'),
  compactionId: text('compaction_id'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_session_entries_session_created').on(table.sessionId, table.createdAt),
  index('idx_session_entries_parent').on(table.sessionId, table.parentEntryId),
  index('idx_session_entries_type').on(table.sessionId, table.entryType),
  index('idx_session_entries_message').on(table.sessionId, table.messageId),
  index('idx_session_entries_compaction').on(table.sessionId, table.compactionId),
]);

export const sessionMessages = sqliteTable('session_messages', {
  messageId: text('message_id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  executionId: text('execution_id'),
  messageKind: text('message_kind').notNull(),
  messageJson: jsonText('message_json').notNull(),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => [
  index('idx_session_messages_session_created').on(table.sessionId, table.createdAt),
  index('idx_session_messages_execution').on(table.executionId),
  uniqueIndex('idx_session_messages_assistant_reply_execution')
    .on(table.sessionId, table.executionId)
    .where(sql`${table.messageKind} = 'assistant_reply'`),
]);

export const sessionMessageAttachments = sqliteTable('session_message_attachments', {
  attachmentId: text('attachment_id').primaryKey(),
  messageId: text('message_id').notNull().references(() => sessionMessages.messageId, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  name: text('name'),
  mimeType: text('mime_type'),
  sourceType: text('source_type').notNull(),
  sourceValue: text('source_value').notNull(),
  ordinal: integer('ordinal').notNull(),
  sizeBytes: integer('size_bytes'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_session_message_attachments_message').on(table.messageId),
  index('idx_session_message_attachments_session').on(table.sessionId),
  uniqueIndex('idx_session_message_attachments_message_ordinal').on(table.messageId, table.ordinal),
]);

export const sessionCompactions = sqliteTable('session_compactions', {
  compactionId: text('compaction_id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
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
}, (table) => [
  index('idx_session_compactions_session_started').on(table.sessionId, table.startedAt),
  index('idx_session_compactions_session_status').on(table.sessionId, table.status),
]);

export const workspaceChanges = sqliteTable('workspace_changes', {
  changeSetId: text('change_set_id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.workspaceId),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  executionId: text('execution_id').notNull(),
  status: text('status').notNull(),
  effectCoverage: text('effect_coverage').notNull(),
  changedFileCount: integer('changed_file_count').notNull(),
  createdAt: text('created_at').notNull(),
  finalizedAt: text('finalized_at'),
}, (table) => [
  index('idx_workspace_changes_execution').on(table.executionId),
  index('idx_workspace_changes_workspace_created').on(table.workspaceId, table.createdAt),
]);

export const workspaceChangedFiles = sqliteTable('workspace_changed_files', {
  changedFileId: text('changed_file_id').primaryKey(),
  changeSetId: text('change_set_id').notNull().references(() => workspaceChanges.changeSetId, { onDelete: 'cascade' }),
  workspacePath: text('workspace_path').notNull(),
  changeKind: text('change_kind').notNull(),
  effectType: text('effect_type').notNull(),
  sourceWorkspacePath: text('source_workspace_path'),
  destinationWorkspacePath: text('destination_workspace_path'),
  pathType: text('path_type').notNull(),
  recoverable: integer('recoverable'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_workspace_changed_files_change').on(table.changeSetId),
  uniqueIndex('idx_workspace_changed_files_change_path').on(table.changeSetId, table.workspacePath),
]);

export const skillAvailability = sqliteTable('skill_availability', {
  skillAvailabilityId: text('skill_availability_id').primaryKey(),
  skillPath: text('skill_path').notNull(),
  available: integer('available').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_skill_availability_path').on(table.skillPath),
]);

export const discoveryInterests = sqliteTable('discovery_interests', {
  interestId: text('interest_id').primaryKey(),
  description: text('description').notNull(),
  status: text('status').notNull(),
  createdFrom: text('created_from').notNull(),
  userManagedAt: text('user_managed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  pausedAt: text('paused_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  check('check_discovery_interests_description', sql`length(trim(${table.description})) BETWEEN 1 AND 1000`),
  check('check_discovery_interests_status', sql`${table.status} IN ('active', 'paused', 'deleted')`),
  check('check_discovery_interests_created_from', sql`${table.createdFrom} IN ('manual', 'conversation')`),
  index('idx_discovery_interests_status_updated').on(table.status, table.updatedAt),
]);

export const discoveryInterestEvidence = sqliteTable('discovery_interest_evidence', {
  evidenceId: text('evidence_id').primaryKey(),
  interestId: text('interest_id').references(() => discoveryInterests.interestId),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().references(() => sessionMessages.messageId, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  effect: text('effect').notNull(),
  confidence: text('confidence').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  appliedAt: text('applied_at'),
  retractedAt: text('retracted_at'),
}, (table) => [
  check('check_discovery_interest_evidence_description', sql`length(trim(${table.description})) BETWEEN 1 AND 1000`),
  check('check_discovery_interest_evidence_effect', sql`${table.effect} IN ('support', 'reject')`),
  check('check_discovery_interest_evidence_confidence', sql`${table.confidence} IN ('high', 'medium')`),
  check('check_discovery_interest_evidence_status', sql`${table.status} IN ('pending', 'applied', 'retracted')`),
  index('idx_discovery_interest_evidence_interest_status').on(table.interestId, table.status),
  index('idx_discovery_interest_evidence_session_status').on(table.sessionId, table.status),
  index('idx_discovery_interest_evidence_message').on(table.messageId),
]);

export const discoverySessionPolicies = sqliteTable('discovery_session_policies', {
  sessionId: text('session_id').primaryKey().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  participation: text('participation').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  check('check_discovery_session_policies_participation', sql`${table.participation} IN ('included', 'excluded')`),
]);

export const discoveryBatches = sqliteTable('discovery_batches', {
  batchId: text('batch_id').primaryKey(),
  localDate: text('local_date').notNull(),
  timezone: text('timezone').notNull(),
  status: text('status').notNull(),
  executionId: text('execution_id').notNull(),
  targetCount: integer('target_count').notNull(),
  attemptCount: integer('attempt_count').notNull().default(1),
  automaticRetryCount: integer('automatic_retry_count').notNull().default(0),
  resultCount: integer('result_count').notNull().default(0),
  failureCode: text('failure_code'),
  failureMessage: text('failure_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  startedAt: text('started_at').notNull(),
  publishedAt: text('published_at'),
}, (table) => [
  uniqueIndex('idx_discovery_batches_local_date').on(table.localDate),
  check('check_discovery_batches_status', sql`${table.status} IN ('running', 'published', 'failed')`),
  check('check_discovery_batches_target_count', sql`${table.targetCount} BETWEEN 1 AND 100`),
  check('check_discovery_batches_attempt_count', sql`${table.attemptCount} >= 1`),
  check('check_discovery_batches_automatic_retry_count', sql`${table.automaticRetryCount} BETWEEN 0 AND 2`),
  check('check_discovery_batches_result_count', sql`${table.resultCount} >= 0`),
  index('idx_discovery_batches_status').on(table.status),
  index('idx_discovery_batches_published_at').on(table.publishedAt),
]);

export const discoveryRecommendations = sqliteTable('discovery_recommendations', {
  recommendationId: text('recommendation_id').primaryKey(),
  batchId: text('batch_id').notNull().references(() => discoveryBatches.batchId, { onDelete: 'cascade' }),
  contentIdentity: text('content_identity').notNull(),
  position: integer('position').notNull(),
  sourceId: text('source_id').notNull(),
  sourceName: text('source_name').notNull(),
  canonicalUrl: text('canonical_url').notNull(),
  title: text('title').notNull(),
  contentType: text('content_type').notNull(),
  sourceContentId: text('source_content_id'),
  author: text('author'),
  contentPublishedAt: text('content_published_at'),
  description: text('description'),
  coverUrl: text('cover_url'),
  recommendationReason: text('recommendation_reason').notNull(),
  reaction: text('reaction'),
  hiddenAt: text('hidden_at'),
  favoriteAt: text('favorite_at'),
  watchLaterAt: text('watch_later_at'),
  firstOpenedAt: text('first_opened_at'),
  lastOpenedAt: text('last_opened_at'),
  publishedAt: text('published_at').notNull(),
  stateUpdatedAt: text('state_updated_at'),
}, (table) => [
  uniqueIndex('idx_discovery_recommendations_content_identity').on(table.contentIdentity),
  uniqueIndex('idx_discovery_recommendations_batch_position').on(table.batchId, table.position),
  check('check_discovery_recommendations_position', sql`${table.position} >= 0`),
  check('check_discovery_recommendations_source_id', sql`length(trim(${table.sourceId})) > 0`),
  check('check_discovery_recommendations_source_name', sql`length(trim(${table.sourceName})) > 0`),
  check('check_discovery_recommendations_canonical_url', sql`length(trim(${table.canonicalUrl})) > 0`),
  check('check_discovery_recommendations_title', sql`length(trim(${table.title})) > 0`),
  check('check_discovery_recommendations_content_type', sql`${table.contentType} IN ('video', 'article', 'news', 'project', 'post', 'page', 'other')`),
  check('check_discovery_recommendations_reason', sql`length(trim(${table.recommendationReason})) BETWEEN 1 AND 1000`),
  check('check_discovery_recommendations_reaction', sql`${table.reaction} IS NULL OR ${table.reaction} IN ('liked', 'disliked')`),
  index('idx_discovery_recommendations_published_at').on(table.publishedAt),
  index('idx_discovery_recommendations_favorite_at').on(table.favoriteAt),
  index('idx_discovery_recommendations_watch_later_at').on(table.watchLaterAt),
]);
