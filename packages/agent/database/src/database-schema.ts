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
  uniqueIndex('idx_session_entries_message_identity')
    .on(table.messageId)
    .where(sql`${table.entryType} = 'message' AND ${table.messageId} IS NOT NULL`),
  uniqueIndex('idx_session_entries_compaction_identity')
    .on(table.compactionId)
    .where(sql`${table.entryType} = 'compaction' AND ${table.compactionId} IS NOT NULL`),
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
  uniqueIndex('idx_workspace_changes_scope').on(
    table.workspaceId,
    table.sessionId,
    table.executionId,
  ),
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
  id: text('id').primaryKey(),
  description: text('description').notNull(),
  status: text('status').notNull(),
  createdFrom: text('created_from').notNull(),
  revision: integer('revision').notNull().default(1),
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
  id: text('id').primaryKey(),
  interestId: text('interest_id').references(() => discoveryInterests.id),
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

export const discoveryInterestSessionSettings = sqliteTable('discovery_interest_session_settings', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
  participation: text('participation').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  check('check_discovery_interest_session_settings_participation', sql`${table.participation} IN ('included', 'excluded')`),
  uniqueIndex('idx_discovery_interest_session_settings_session').on(table.sessionId),
]);

export const discoveryRecommendations = sqliteTable('discovery_recommendations', {
  id: text('id').primaryKey(),
  candidateId: text('candidate_id').notNull().references(() => discoveryCandidates.id),
  contentIdentity: text('content_identity').notNull(),
  localDate: text('local_date').notNull(),
  position: integer('position').notNull(),
  recommendationReason: text('recommendation_reason').notNull(),
  selectionBasisJson: jsonText('selection_basis_json').notNull(),
  publishedAt: text('published_at').notNull(),
}, (table) => [
  uniqueIndex('idx_discovery_recommendations_candidate').on(table.candidateId),
  uniqueIndex('idx_discovery_recommendations_content_identity').on(table.contentIdentity),
  uniqueIndex('idx_discovery_recommendations_date_position').on(table.localDate, table.position),
  check('check_discovery_recommendations_position', sql`${table.position} >= 0`),
  check('check_discovery_recommendations_reason', sql`length(trim(${table.recommendationReason})) BETWEEN 1 AND 1000`),
  index('idx_discovery_recommendations_date').on(table.localDate, table.position),
  index('idx_discovery_recommendations_published_at').on(table.publishedAt),
]);

export const discoveryRecommendationContents = sqliteTable('discovery_recommendation_contents', {
  id: text('id').primaryKey(),
  recommendationId: text('recommendation_id').notNull()
    .references(() => discoveryRecommendations.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  sourceName: text('source_name').notNull(),
  sourceContentId: text('source_content_id'),
  canonicalUrl: text('canonical_url').notNull(),
  contentType: text('content_type').notNull(),
  title: text('title').notNull(),
  author: text('author'),
  contentPublishedAt: text('content_published_at'),
  description: text('description'),
  contentSummary: text('content_summary').notNull(),
  contentExcerpt: text('content_excerpt'),
  contentTruncated: integer('content_truncated').notNull().default(0),
  coverUrl: text('cover_url'),
}, (table) => [
  uniqueIndex('idx_discovery_recommendation_contents_recommendation').on(table.recommendationId),
  check('check_discovery_recommendation_contents_source_id', sql`length(trim(${table.sourceId})) > 0`),
  check('check_discovery_recommendation_contents_source_name', sql`length(trim(${table.sourceName})) > 0`),
  check('check_discovery_recommendation_contents_url', sql`length(trim(${table.canonicalUrl})) > 0`),
  check('check_discovery_recommendation_contents_type', sql`${table.contentType} IN ('video', 'article', 'news', 'project', 'post', 'page', 'other')`),
  check('check_discovery_recommendation_contents_title', sql`length(trim(${table.title})) > 0`),
  check('check_discovery_recommendation_contents_summary', sql`length(trim(${table.contentSummary})) BETWEEN 1 AND 1000`),
  check('check_discovery_recommendation_contents_excerpt', sql`${table.contentExcerpt} IS NULL OR length(trim(${table.contentExcerpt})) > 0`),
  check('check_discovery_recommendation_contents_truncated', sql`${table.contentTruncated} IN (0, 1)`),
  check('check_discovery_recommendation_contents_excerpt_shape', sql`${table.contentExcerpt} IS NOT NULL OR ${table.contentTruncated} = 0`),
  index('idx_discovery_recommendation_contents_source').on(table.sourceId, table.recommendationId),
]);

export const discoveryRecommendationStates = sqliteTable('discovery_recommendation_states', {
  id: text('id').primaryKey(),
  recommendationId: text('recommendation_id').notNull()
    .references(() => discoveryRecommendations.id, { onDelete: 'cascade' }),
  reaction: text('reaction'),
  reactionRevision: integer('reaction_revision').notNull().default(0),
  reactionChangedAt: text('reaction_changed_at'),
  learnedReaction: text('learned_reaction'),
  learnedReactionRevision: integer('learned_reaction_revision').notNull().default(0),
  favoriteAt: text('favorite_at'),
  watchLaterAt: text('watch_later_at'),
  hiddenAt: text('hidden_at'),
  firstOpenedAt: text('first_opened_at'),
  lastOpenedAt: text('last_opened_at'),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_discovery_recommendation_states_recommendation').on(table.recommendationId),
  check('check_discovery_recommendation_states_reaction', sql`${table.reaction} IS NULL OR ${table.reaction} IN ('liked', 'disliked')`),
  check('check_discovery_recommendation_states_learned_reaction', sql`${table.learnedReaction} IS NULL OR ${table.learnedReaction} IN ('liked', 'disliked')`),
  check('check_discovery_recommendation_states_revisions', sql`${table.reactionRevision} >= 0 AND ${table.learnedReactionRevision} >= 0 AND ${table.learnedReactionRevision} <= ${table.reactionRevision}`),
  check('check_discovery_recommendation_states_reaction_zero', sql`${table.reactionRevision} > 0 OR (${table.reaction} IS NULL AND ${table.reactionChangedAt} IS NULL AND ${table.learnedReaction} IS NULL)`),
  check('check_discovery_recommendation_states_reaction_time', sql`${table.reactionRevision} = 0 OR ${table.reactionChangedAt} IS NOT NULL`),
  check('check_discovery_recommendation_states_learned_matches_current', sql`${table.learnedReactionRevision} <> ${table.reactionRevision} OR ${table.learnedReaction} IS ${table.reaction}`),
  check('check_discovery_recommendation_states_opened_shape', sql`(${table.firstOpenedAt} IS NULL AND ${table.lastOpenedAt} IS NULL) OR (${table.firstOpenedAt} IS NOT NULL AND ${table.lastOpenedAt} IS NOT NULL AND ${table.firstOpenedAt} <= ${table.lastOpenedAt})`),
  index('idx_discovery_recommendation_states_favorite').on(table.favoriteAt),
  index('idx_discovery_recommendation_states_watch_later').on(table.watchLaterAt),
  index('idx_discovery_recommendation_states_pending_reaction').on(table.reactionRevision, table.learnedReactionRevision),
]);

export const discoveryCandidates = sqliteTable('discovery_candidates', {
  id: text('id').primaryKey(),
  contentIdentity: text('content_identity').notNull(),
  sourceId: text('source_id').notNull(),
  sourceContentId: text('source_content_id'),
  canonicalUrl: text('canonical_url').notNull(),
  contentType: text('content_type').notNull(),
  title: text('title').notNull(),
  author: text('author'),
  publishedAt: text('published_at'),
  description: text('description'),
  contentSummary: text('content_summary').notNull(),
  contentExcerpt: text('content_excerpt'),
  contentTruncated: integer('content_truncated').notNull().default(0),
  coverUrl: text('cover_url'),
  status: text('status').notNull().default('available'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
}, (table) => [
  uniqueIndex('idx_discovery_candidates_content_identity').on(table.contentIdentity),
  uniqueIndex('idx_discovery_candidates_canonical_url').on(table.canonicalUrl),
  uniqueIndex('idx_discovery_candidates_source_content')
    .on(table.sourceId, table.sourceContentId)
    .where(sql`${table.sourceContentId} IS NOT NULL`),
  check('check_discovery_candidates_content_type', sql`${table.contentType} IN ('video', 'article', 'news', 'project', 'post', 'page', 'other')`),
  check('check_discovery_candidates_title', sql`length(trim(${table.title})) > 0`),
  check('check_discovery_candidates_content_summary', sql`length(trim(${table.contentSummary})) BETWEEN 1 AND 1000`),
  check('check_discovery_candidates_content_excerpt', sql`${table.contentExcerpt} IS NULL OR length(trim(${table.contentExcerpt})) > 0`),
  check('check_discovery_candidates_content_truncated', sql`${table.contentTruncated} IN (0, 1)`),
  check('check_discovery_candidates_excerpt_shape', sql`${table.contentExcerpt} IS NOT NULL OR ${table.contentTruncated} = 0`),
  check('check_discovery_candidates_status', sql`${table.status} IN ('available', 'consumed', 'expired')`),
  check('check_discovery_candidates_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
  index('idx_discovery_candidates_status_expires').on(table.status, table.expiresAt),
]);

export const discoveryCandidateInterestMatches = sqliteTable('discovery_candidate_interest_matches', {
  id: text('id').primaryKey(),
  candidateId: text('candidate_id').notNull()
    .references(() => discoveryCandidates.id, { onDelete: 'cascade' }),
  interestId: text('interest_id').notNull().references(() => discoveryInterests.id),
  relevance: text('relevance').notNull(),
  matchReason: text('match_reason').notNull(),
}, (table) => [
  uniqueIndex('idx_discovery_candidate_interest_matches_pair').on(table.candidateId, table.interestId),
  index('idx_discovery_candidate_interest_matches_interest').on(table.interestId, table.candidateId),
  check('check_discovery_candidate_interest_matches_relevance', sql`${table.relevance} IN ('direct', 'adjacent', 'exploration')`),
  check('check_discovery_candidate_interest_matches_reason', sql`length(trim(${table.matchReason})) BETWEEN 1 AND 1000`),
]);

export const discoveryPreferenceSets = sqliteTable('discovery_preference_sets', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),
  interestId: text('interest_id').references(() => discoveryInterests.id),
  revision: integer('revision').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  check('check_preference_sets_scope', sql`${table.scope} IN ('interest','exploration')`),
  check('check_preference_sets_shape', sql`(${table.scope}='interest' AND ${table.interestId} IS NOT NULL) OR (${table.scope}='exploration' AND ${table.interestId} IS NULL)`),
  check('check_preference_sets_revision', sql`${table.revision} >= 0`),
  uniqueIndex('idx_preference_sets_interest').on(table.interestId).where(sql`${table.interestId} IS NOT NULL`),
  uniqueIndex('idx_preference_sets_exploration').on(table.scope).where(sql`${table.scope}='exploration'`),
]);
export const discoveryPreferences = sqliteTable('discovery_preferences', {
  id: text('id').primaryKey(),
  preferenceSetId: text('preference_set_id').notNull().references(() => discoveryPreferenceSets.id, { onDelete: 'cascade' }),
  polarity: text('polarity').notNull(),
  dimension: text('dimension').notNull(),
  statement: text('statement').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  check('check_preferences_polarity', sql`${table.polarity} IN ('positive','negative')`),
  check('check_preferences_dimension', sql`${table.dimension} IN ('topic','source','author','content_type','recency','expression_quality')`),
  check('check_preferences_statement', sql`length(trim(${table.statement})) BETWEEN 1 AND 1000`),
  index('idx_preferences_set').on(table.preferenceSetId),
]);
export const discoveryPreferenceEvidence = sqliteTable('discovery_preference_evidence', {
  id: text('id').primaryKey(),
  preferenceId: text('preference_id').notNull().references(() => discoveryPreferences.id, { onDelete: 'cascade' }),
  recommendationId: text('recommendation_id').notNull().references(() => discoveryRecommendations.id, { onDelete: 'cascade' }),
  reactionRevision: integer('reaction_revision').notNull(),
  reaction: text('reaction').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  check('check_preference_evidence_revision', sql`${table.reactionRevision} > 0`),
  check('check_preference_evidence_reaction', sql`${table.reaction} IN ('liked','disliked')`),
  uniqueIndex('idx_preference_evidence_pair').on(table.preferenceId, table.recommendationId),
  index('idx_preference_evidence_recommendation').on(table.recommendationId),
]);
