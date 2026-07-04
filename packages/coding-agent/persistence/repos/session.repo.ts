/*
 * Transitional Session persistence facade for callers that have not yet moved
 * to the Session module repository directly. It preserves the old method
 * names while writing only the target Session schema columns.
 */
import type { MegumiDatabase } from '../connection';
import type { JsonObject } from '@megumi/shared/primitives';
import type { ModelInputContextSourceRef } from '@megumi/shared/model';
import {
  SessionActiveLeafSchema,
  SessionActivePathSchema,
  SessionCompactionEntrySchema,
  SessionInterruptedRunMarkerSchema,
  SessionRetryAttemptSchema,
  SessionSourceEntrySchema,
  type Session,
  type SessionActiveLeaf,
  type SessionActivePath,
  type SessionBranchMarker,
  type SessionCompactionEntry,
  type SessionInterruptedRunMarker,
  type SessionMessage,
  type SessionRetryAttempt,
  type SessionSourceEntry,
} from '@megumi/shared/session';

type Nullable<T> = T | null;

const defaultWorkspaceId = 'workspace:default';

export function ensureWorkspace(
  database: MegumiDatabase,
  input: { workspaceId?: string | null; workspacePath?: string | null; now: string },
): string {
  const workspaceId = input.workspaceId ?? defaultWorkspaceId;
  const existing = database.prepare('SELECT workspace_id FROM workspaces WHERE workspace_id = ?')
    .get(workspaceId) as { workspace_id: string } | undefined;

  if (!existing) {
    throw new Error(`Workspace ${workspaceId} must be created before session persistence.`);
  }

  return workspaceId;
}

export function defaultBranchIdForSession(sessionId: string): string {
  return `${sessionId}:branch:default`;
}

export function ensureSessionDefaultBranch(
  database: MegumiDatabase,
  input: { sessionId: string; now: string },
): string {
  const session = database.prepare('SELECT session_id FROM sessions WHERE session_id = ?')
    .get(input.sessionId) as { session_id: string } | undefined;
  if (!session) {
    throw new Error(`Session ${input.sessionId} does not exist`);
  }
  return session.session_id;
}

export function activeBranchIdForSession(database: MegumiDatabase, sessionId: string, now: string): string {
  return ensureSessionDefaultBranch(database, { sessionId, now });
}

export function appendPathNode(
  database: MegumiDatabase,
  input: {
    pathNodeId: string;
    sessionId: string;
    branchId: string;
    parentPathNodeId?: string | null;
    sourceKind: string;
    sourceId: string;
    createdAt: string;
    metadataJson?: string | null;
  },
): void {
  const current = database.prepare('SELECT active_entry_id FROM sessions WHERE session_id = ?')
    .get(input.sessionId) as { active_entry_id: string | null } | undefined;
  if (!current) {
    throw new Error(`Session ${input.sessionId} does not exist`);
  }

  database.prepare(`
    INSERT INTO session_entries (
      entry_id, session_id, parent_entry_id, entry_type, message_id, compaction_id, created_at
    ) VALUES (
      @entry_id, @session_id, @parent_entry_id, @entry_type, @message_id, @compaction_id, @created_at
    )
    ON CONFLICT(entry_id) DO UPDATE SET
      parent_entry_id = excluded.parent_entry_id
  `).run({
    entry_id: input.pathNodeId,
    session_id: input.sessionId,
    parent_entry_id: input.parentPathNodeId ?? current.active_entry_id ?? null,
    entry_type: databaseEntryType(input.sourceKind),
    message_id: input.sourceKind === 'session_message' ? input.sourceId : null,
    compaction_id: input.sourceKind === 'session_compaction' ? input.sourceId : null,
    created_at: input.createdAt,
  });

  database.prepare(`
    UPDATE sessions
    SET active_entry_id = @entry_id,
        updated_at = @created_at
    WHERE session_id = @session_id
  `).run({
    entry_id: input.pathNodeId,
    session_id: input.sessionId,
    created_at: input.createdAt,
  });
}

export interface CreateSessionInput {
  sessionId: string;
  workspaceId: string;
  title: string;
  now: string;
}

export interface AppendUserMessageInput {
  messageId: string;
  sessionId: string;
  contentText: string;
  createdAt: string;
  blocksJson?: string | null;
  metadataJson?: string | null;
  leafChangeReason?: 'user_input_created' | 'retry_input_created' | 'rerun_input_created' | 'recovery_input_created';
}

export interface LinkUserMessageToRunInput {
  messageId: string;
  runId: string;
}

export interface AppendAssistantMessageInput {
  runId: string;
  messageId: string;
  sessionId: string;
  contentText: string;
  completedAt: string;
  blocksJson?: string | null;
  metadataJson?: string | null;
}

interface SessionRow {
  session_id: string;
  workspace_id: Nullable<string>;
  title: string;
  status: Session['status'];
  active_entry_id: Nullable<string>;
  created_at: string;
  updated_at: string;
  archived_at: Nullable<string>;
}

interface SessionMessageRow {
  message_id: string;
  session_id: string;
  run_id: Nullable<string>;
  role: SessionMessage['role'];
  content_text: string;
  created_at: string;
  completed_at: Nullable<string>;
}

interface SourceEntryRow {
  entry_id: string;
  session_id: string;
  parent_entry_id: Nullable<string>;
  entry_type: string;
  message_id: Nullable<string>;
  compaction_id: Nullable<string>;
  created_at: string;
}

interface SessionCompactionRow {
  compaction_id: string;
  session_id: string;
  summary_text: string;
  covered_until_entry_id: Nullable<string>;
  first_kept_entry_id: Nullable<string>;
  created_at: string;
}

interface CompatEventRow {
  payload_json: string;
  event_json: string;
}

type SourceRefLookup = Pick<ModelInputContextSourceRef, 'sourceKind' | 'sourceId'>;

export class SessionRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveSession(session: Session): Session {
    const row = toSessionRow(session);
    row.workspace_id = ensureWorkspace(this.database, {
      workspaceId: session.workspaceId,
      workspacePath: session.workspacePath,
      now: session.createdAt,
    });
    this.database.prepare(`
      INSERT INTO sessions (
        session_id, workspace_id, title, status, active_entry_id,
        created_at, updated_at, archived_at
      ) VALUES (
        @session_id, @workspace_id, @title, @status, @active_entry_id,
        @created_at, @updated_at, @archived_at
      )
      ON CONFLICT(session_id) DO UPDATE SET
        title = excluded.title,
        workspace_id = excluded.workspace_id,
        status = excluded.status,
        active_entry_id = excluded.active_entry_id,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at
    `).run(row);
    return this.getSession(session.sessionId) ?? session;
  }

  getSession(sessionId: string): Session | undefined {
    const row = this.database.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as SessionRow | undefined;
    return row ? fromSessionRow(row) : undefined;
  }

  listSessions(): Session[] {
    return (this.database.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionRow[])
      .map(fromSessionRow);
  }

  createSession(input: CreateSessionInput): { sessionId: string } {
    this.saveSession({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      title: input.title,
      status: 'active',
      createdAt: input.now,
      updatedAt: input.now,
    });
    return { sessionId: input.sessionId };
  }

  saveMessage(message: SessionMessage): SessionMessage {
    ensureSessionDefaultBranch(this.database, { sessionId: message.sessionId, now: message.createdAt });
    this.database.prepare(`
      INSERT INTO session_messages (
        message_id, session_id, run_id, role, content_text, created_at, completed_at
      ) VALUES (
        @message_id, @session_id, @run_id, @role, @content_text, @created_at, @completed_at
      )
      ON CONFLICT(message_id) DO UPDATE SET
        run_id = excluded.run_id,
        content_text = excluded.content_text,
        completed_at = excluded.completed_at
    `).run(toMessageRow(message));
    return this.getMessage(message.messageId) ?? message;
  }

  getMessage(messageId: string): SessionMessage | undefined {
    const row = this.database.prepare('SELECT * FROM session_messages WHERE message_id = ?').get(messageId) as SessionMessageRow | undefined;
    return row ? fromMessageRow(row) : undefined;
  }

  listMessagesBySession(sessionId: string): SessionMessage[] {
    return (this.database.prepare(`
      SELECT * FROM session_messages
      WHERE session_id = ?
      ORDER BY created_at ASC, message_id ASC
    `).all(sessionId) as SessionMessageRow[]).map(fromMessageRow);
  }

  appendUserMessage(input: AppendUserMessageInput): { messageId: string; entryId: string } {
    const message = this.saveMessage({
      messageId: input.messageId,
      sessionId: input.sessionId,
      role: 'user',
      content: input.contentText,
      status: 'completed',
      createdAt: input.createdAt,
      completedAt: input.createdAt,
    });
    const entryId = `message:${input.messageId}`;
    appendPathNode(this.database, {
      pathNodeId: entryId,
      sessionId: input.sessionId,
      branchId: defaultBranchIdForSession(input.sessionId),
      sourceKind: 'session_message',
      sourceId: input.messageId,
      createdAt: input.createdAt,
    });
    return { messageId: message.messageId, entryId };
  }

  linkUserMessageToRun(input: LinkUserMessageToRunInput): void {
    this.database.prepare(`
      UPDATE session_messages
      SET run_id = @run_id
      WHERE message_id = @message_id
        AND role = 'user'
    `).run({
      run_id: input.runId,
      message_id: input.messageId,
    });
  }

  appendAssistantMessage(input: AppendAssistantMessageInput): { messageId: string; entryId: string } {
    const message = this.saveMessage({
      messageId: input.messageId,
      sessionId: input.sessionId,
      runId: input.runId,
      role: 'assistant',
      content: input.contentText,
      status: 'completed',
      createdAt: input.completedAt,
      completedAt: input.completedAt,
    });
    const entryId = `message:${input.messageId}`;
    appendPathNode(this.database, {
      pathNodeId: entryId,
      sessionId: input.sessionId,
      branchId: defaultBranchIdForSession(input.sessionId),
      sourceKind: 'session_message',
      sourceId: input.messageId,
      createdAt: input.completedAt,
    });
    return { messageId: message.messageId, entryId };
  }

  appendSourceEntry(entry: SessionSourceEntry): SessionSourceEntry {
    const parsed = SessionSourceEntrySchema.parse(entry);
    if (parsed.parentSourceEntryId) {
      this.assertSourceEntryBelongsToSession(parsed.sessionId, parsed.parentSourceEntryId, 'parentSourceEntryId');
    }
    this.database.prepare(`
      INSERT INTO session_entries (
        entry_id, session_id, parent_entry_id, entry_type, message_id, compaction_id, created_at
      ) VALUES (
        @entry_id, @session_id, @parent_entry_id, @entry_type, @message_id, @compaction_id, @created_at
      )
    `).run({
      entry_id: parsed.sourceEntryId,
      session_id: parsed.sessionId,
      parent_entry_id: parsed.parentSourceEntryId ?? null,
      entry_type: databaseEntryType(parsed.sourceRef.sourceKind),
      message_id: parsed.sourceRef.sourceKind === 'session_message' ? parsed.sourceRef.sourceId : null,
      compaction_id: null,
      created_at: parsed.createdAt,
    });
    return parsed;
  }

  appendSourceEntryAndSetActiveLeaf(
    entry: SessionSourceEntry,
    activeLeaf: SessionActiveLeaf,
  ): SessionSourceEntry {
    return this.database.transaction((sourceEntry: SessionSourceEntry, nextActiveLeaf: SessionActiveLeaf) => {
      const appended = this.appendSourceEntry(sourceEntry);
      this.setActiveLeaf(nextActiveLeaf);
      return appended;
    })(entry, activeLeaf);
  }

  getSourceEntry(sourceEntryId: string): SessionSourceEntry | undefined {
    const row = this.database.prepare('SELECT * FROM session_entries WHERE entry_id = ?')
      .get(sourceEntryId) as SourceEntryRow | undefined;
    return row ? fromSourceEntryRow(row) : undefined;
  }

  getSourceEntryBySourceRef(sessionId: string, sourceRef: SourceRefLookup): SessionSourceEntry | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM session_entries
      WHERE session_id = ?
        AND (
          (message_id = ? AND ? = 'session_message')
          OR (compaction_id = ? AND ? = 'session_compaction')
          OR (entry_id = ? AND entry_type = ?)
        )
      ORDER BY created_at ASC, entry_id ASC
      LIMIT 1
    `).get(
      sessionId,
      sourceRef.sourceId,
      sourceRef.sourceKind,
      sourceRef.sourceId,
      sourceRef.sourceKind,
      sourceRef.sourceId,
      databaseEntryType(sourceRef.sourceKind),
    ) as SourceEntryRow | undefined;
    return row ? fromSourceEntryRow(row) : undefined;
  }

  listSourceEntriesBySession(sessionId: string): SessionSourceEntry[] {
    return (this.database.prepare(`
      SELECT *
      FROM session_entries
      WHERE session_id = ?
      ORDER BY created_at ASC, entry_id ASC
    `).all(sessionId) as SourceEntryRow[]).map(fromSourceEntryRow);
  }

  setActiveLeaf(activeLeaf: SessionActiveLeaf): SessionActiveLeaf {
    const parsed = SessionActiveLeafSchema.parse(activeLeaf);
    if (parsed.leafSourceEntryId) {
      this.assertSourceEntryBelongsToSession(parsed.sessionId, parsed.leafSourceEntryId, 'leafSourceEntryId');
    }
    this.database.prepare(`
      UPDATE sessions
      SET active_entry_id = @active_entry_id,
          updated_at = @updated_at
      WHERE session_id = @session_id
    `).run({
      active_entry_id: parsed.leafSourceEntryId ?? null,
      updated_at: parsed.updatedAt,
      session_id: parsed.sessionId,
    });
    return this.getActiveLeaf(parsed.sessionId) ?? parsed;
  }

  getActiveLeaf(sessionId: string): SessionActiveLeaf | undefined {
    const row = this.database.prepare(`
      SELECT session_id, active_entry_id, updated_at
      FROM sessions
      WHERE session_id = ?
    `).get(sessionId) as { session_id: string; active_entry_id: string | null; updated_at: string } | undefined;
    if (!row) {
      return undefined;
    }
    return SessionActiveLeafSchema.parse({
      sessionId: row.session_id,
      leafSourceEntryId: row.active_entry_id ?? null,
      updatedAt: row.updated_at,
      reason: row.active_entry_id ? 'source_appended' : 'session_created',
    });
  }

  getActivePath(sessionId: string): SessionActivePath {
    const activeLeaf = this.getActiveLeaf(sessionId);
    if (!activeLeaf?.leafSourceEntryId) {
      return SessionActivePathSchema.parse({ sessionId, entries: [] });
    }
    const entriesById = new Map(this.listSourceEntriesBySession(sessionId).map((entry) => [entry.sourceEntryId, entry]));
    const path: SessionSourceEntry[] = [];
    const seen = new Set<string>();
    let currentId: string | undefined = activeLeaf.leafSourceEntryId;

    while (currentId) {
      if (seen.has(currentId)) {
        throw new Error(`Cycle detected in session active path for ${sessionId}: ${currentId}`);
      }
      seen.add(currentId);
      const entry = entriesById.get(currentId);
      if (!entry) {
        throw new Error(`Active path source entry ${currentId} was not found in session ${sessionId}`);
      }
      path.unshift(entry);
      currentId = entry.parentSourceEntryId;
    }

    return SessionActivePathSchema.parse({
      sessionId,
      leafSourceEntryId: activeLeaf.leafSourceEntryId,
      entries: path,
    });
  }

  listActivePathSourceRefs(sessionId: string): ModelInputContextSourceRef[] {
    return this.getActivePath(sessionId).entries.map((entry) => entry.sourceRef);
  }

  findActivePathEntryBySourceRef(sessionId: string, sourceRef: SourceRefLookup): SessionSourceEntry | undefined {
    return this.getActivePath(sessionId).entries.find(
      (entry) => entry.sourceRef.sourceKind === sourceRef.sourceKind && entry.sourceRef.sourceId === sourceRef.sourceId,
    );
  }

  saveSessionCompaction(entry: SessionCompactionEntry): void {
    const parsed = SessionCompactionEntrySchema.parse(entry);
    ensureSessionDefaultBranch(this.database, { sessionId: parsed.sessionId, now: parsed.createdAt });
    this.database.prepare(`
      INSERT INTO session_compactions (
        compaction_id, session_id, summary_text, covered_until_entry_id, first_kept_entry_id, created_at
      ) VALUES (
        @compaction_id, @session_id, @summary_text, NULL, @first_kept_entry_id, @created_at
      )
      ON CONFLICT(compaction_id) DO UPDATE SET
        summary_text = excluded.summary_text,
        first_kept_entry_id = excluded.first_kept_entry_id
    `).run({
      compaction_id: parsed.compactionId,
      session_id: parsed.sessionId,
      summary_text: parsed.summary,
      first_kept_entry_id: sourceRefToPathNodeId(parsed.firstKeptSourceRef),
      created_at: parsed.createdAt,
    });
  }

  getSessionCompaction(compactionId: string): SessionCompactionEntry | null {
    const row = this.database.prepare('SELECT * FROM session_compactions WHERE compaction_id = ?')
      .get(compactionId) as SessionCompactionRow | undefined;
    return row ? fromCompactionRow(row) : null;
  }

  listSessionCompactionsBySession(sessionId: string): SessionCompactionEntry[] {
    return (this.database.prepare(`
      SELECT *
      FROM session_compactions
      WHERE session_id = ?
      ORDER BY created_at DESC, compaction_id DESC
    `).all(sessionId) as SessionCompactionRow[]).map(fromCompactionRow);
  }

  getLatestCompletedSessionCompaction(sessionId: string): SessionCompactionEntry | null {
    const row = this.database.prepare(`
      SELECT *
      FROM session_compactions
      WHERE session_id = ?
      ORDER BY created_at DESC, compaction_id DESC
      LIMIT 1
    `).get(sessionId) as SessionCompactionRow | undefined;
    return row ? fromCompactionRow(row) : null;
  }

  saveSessionCompactionWithActivePath(input: {
    compaction: SessionCompactionEntry;
    sourceEntry: SessionSourceEntry;
    activeLeaf: SessionActiveLeaf;
    expectedCurrentLeafSourceEntryId?: string;
  }): { sourceEntry: SessionSourceEntry; activeLeafAdvanced: boolean } {
    return this.database.transaction(() => {
      this.saveSessionCompaction(input.compaction);
      const sourceEntry = this.appendSourceEntry(input.sourceEntry);
      const activeLeaf = SessionActiveLeafSchema.parse(input.activeLeaf);
      const currentLeaf = this.getActiveLeaf(activeLeaf.sessionId);
      const expectedLeaf = input.expectedCurrentLeafSourceEntryId ?? null;
      let activeLeafAdvanced = false;
      if ((currentLeaf?.leafSourceEntryId ?? null) === expectedLeaf) {
        this.setActiveLeaf(activeLeaf);
        activeLeafAdvanced = true;
      }
      return { sourceEntry, activeLeafAdvanced };
    })();
  }

  saveRetryAttempt(attempt: SessionRetryAttempt): SessionRetryAttempt {
    const parsed = SessionRetryAttemptSchema.parse(attempt);
    this.writeCompatEvent({
      eventId: retryAttemptEventId(parsed.retryAttemptId),
      sessionId: parsed.sessionId,
      runId: parsed.runId,
      eventType: 'session.retry_attempt',
      createdAt: parsed.createdAt,
      payload: { retryAttempt: parsed },
    });
    return parsed;
  }

  listRetryAttemptsByRun(runId: string): SessionRetryAttempt[] {
    return this.listCompatEventsByRun(runId, 'session.retry_attempt')
      .map((row) => parseJson<{ retryAttempt?: SessionRetryAttempt }>(row.payload_json).retryAttempt)
      .filter((attempt): attempt is SessionRetryAttempt => Boolean(attempt))
      .map((attempt) => SessionRetryAttemptSchema.parse(attempt));
  }

  recordBranchMarker(marker: SessionBranchMarker): SessionBranchMarker {
    return marker;
  }

  listBranchMarkersBySession(_sessionId: string): SessionBranchMarker[] {
    return [];
  }

  getBranchMarker(_branchMarkerId: string): SessionBranchMarker | undefined {
    return undefined;
  }

  listChildSourceEntries(parentSourceEntryId: string): SessionSourceEntry[] {
    return (this.database.prepare(`
      SELECT *
      FROM session_entries
      WHERE parent_entry_id = ?
      ORDER BY created_at ASC, entry_id ASC
    `).all(parentSourceEntryId) as SourceEntryRow[]).map(fromSourceEntryRow);
  }

  recordInterruptedRunMarker(marker: SessionInterruptedRunMarker): SessionInterruptedRunMarker {
    const parsed = SessionInterruptedRunMarkerSchema.parse(marker);
    this.writeCompatEvent({
      eventId: interruptedMarkerEventId(parsed.interruptedMarkerId),
      sessionId: parsed.sessionId,
      runId: parsed.runId,
      eventType: 'session.interrupted_run_marker',
      createdAt: parsed.markedAt,
      payload: { interruptedRunMarker: parsed },
    });
    return parsed;
  }

  listInterruptedRunMarkersByRun(runId: string): SessionInterruptedRunMarker[] {
    return this.listCompatEventsByRun(runId, 'session.interrupted_run_marker')
      .map((row) => parseJson<{ interruptedRunMarker?: SessionInterruptedRunMarker }>(row.payload_json).interruptedRunMarker)
      .filter((marker): marker is SessionInterruptedRunMarker => Boolean(marker))
      .map((marker) => SessionInterruptedRunMarkerSchema.parse(marker));
  }

  private writeCompatEvent(input: {
    eventId: string;
    sessionId: string;
    runId: string;
    eventType: string;
    createdAt: string;
    payload: unknown;
  }): void {
    const sequence = nextEventSequence(this.database, input.runId);
    const payloadJson = stringifyJson(input.payload);
    this.database.prepare(`
      INSERT INTO agent_loop_events (
        event_id, run_id, session_id, sequence, event_type, visibility,
        created_at, payload_json, event_json
      ) VALUES (
        @event_id, @run_id, @session_id, @sequence, @event_type, 'internal',
        @created_at, @payload_json, @event_json
      )
      ON CONFLICT(event_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        event_json = excluded.event_json
    `).run({
      event_id: input.eventId,
      run_id: input.runId,
      session_id: input.sessionId,
      sequence,
      event_type: input.eventType,
      created_at: input.createdAt,
      payload_json: payloadJson,
      event_json: stringifyJson({
        eventId: input.eventId,
        runId: input.runId,
        sessionId: input.sessionId,
        sequence,
        eventType: input.eventType,
        visibility: 'internal',
        createdAt: input.createdAt,
        payload: input.payload,
      }),
    });
  }

  private listCompatEventsByRun(runId: string, eventType: string): CompatEventRow[] {
    return this.database.prepare(`
      SELECT payload_json, event_json
      FROM agent_loop_events
      WHERE run_id = ?
        AND event_type = ?
      ORDER BY created_at ASC, event_id ASC
    `).all(runId, eventType) as CompatEventRow[];
  }

  private assertSourceEntryBelongsToSession(sessionId: string, sourceEntryId: string, fieldName: string): void {
    const row = this.database.prepare(`
      SELECT 1 AS found
      FROM session_entries
      WHERE session_id = ?
        AND entry_id = ?
    `).get(sessionId, sourceEntryId) as { found: 1 } | undefined;
    if (!row) {
      throw new Error(`${fieldName} must belong to session ${sessionId}`);
    }
  }
}

function toSessionRow(session: Session): SessionRow {
  return {
    session_id: session.sessionId,
    workspace_id: session.workspaceId ?? null,
    title: session.title,
    status: session.status,
    active_entry_id: null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    archived_at: session.archivedAt ?? null,
  };
}

function fromSessionRow(row: SessionRow): Session {
  return {
    sessionId: row.session_id,
    title: row.title,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
  };
}

function toMessageRow(message: SessionMessage): SessionMessageRow {
  return {
    message_id: message.messageId,
    session_id: message.sessionId,
    run_id: message.runId ?? null,
    role: message.role,
    content_text: message.content,
    created_at: message.createdAt,
    completed_at: message.completedAt ?? null,
  };
}

function fromMessageRow(row: SessionMessageRow): SessionMessage {
  return {
    messageId: row.message_id,
    sessionId: row.session_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    role: row.role,
    content: row.content_text,
    status: 'completed',
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function fromSourceEntryRow(row: SourceEntryRow): SessionSourceEntry {
  return SessionSourceEntrySchema.parse({
    sourceEntryId: row.entry_id,
    sessionId: row.session_id,
    parentSourceEntryId: row.parent_entry_id ?? undefined,
    sourceRef: {
      sourceId: row.message_id ?? row.compaction_id ?? row.entry_id,
      sourceKind: sourceKindFromDatabase(row.entry_type),
    },
    createdAt: row.created_at,
  });
}

function fromCompactionRow(row: SessionCompactionRow): SessionCompactionEntry {
  return SessionCompactionEntrySchema.parse({
    compactionId: row.compaction_id,
    sessionId: row.session_id,
    summary: row.summary_text,
    summaryKind: 'compaction',
    firstKeptSourceRef: pathNodeIdToSourceRef(row.first_kept_entry_id),
    tokensBefore: 0,
    triggerReason: 'context_budget_pressure',
    status: 'completed',
    createdAt: row.created_at,
  });
}

function sourceRefToPathNodeId(sourceRef: SessionCompactionEntry['firstKeptSourceRef']): string {
  if (sourceRef.sourceKind === 'session_message') {
    return `message:${sourceRef.sourceId}`;
  }
  if (sourceRef.sourceKind === 'session_run') {
    return `run:${sourceRef.sourceId}`;
  }
  return `${sourceRef.sourceKind}:${sourceRef.sourceId}`;
}

function pathNodeIdToSourceRef(pathNodeId: string | null): SessionCompactionEntry['firstKeptSourceRef'] {
  const [prefix, ...rest] = (pathNodeId ?? 'other:unknown').split(':');
  const sourceId = rest.join(':') || 'unknown';
  if (prefix === 'message') {
    return { sourceKind: 'session_message', sourceId };
  }
  if (prefix === 'run') {
    return { sourceKind: 'session_run', sourceId };
  }
  return { sourceKind: 'other', sourceId };
}

function databaseEntryType(sourceKind: string): string {
  return sourceKind === 'session_run' ? 'agent_loop_run' : sourceKind;
}

function sourceKindFromDatabase(entryType: string): ModelInputContextSourceRef['sourceKind'] {
  return (entryType === 'agent_loop_run' ? 'session_run' : entryType) as ModelInputContextSourceRef['sourceKind'];
}

function retryAttemptEventId(retryAttemptId: string): string {
  return `compat:retry-attempt:${retryAttemptId}`;
}

function interruptedMarkerEventId(interruptedMarkerId: string): string {
  return `compat:interrupted-run-marker:${interruptedMarkerId}`;
}

function nextEventSequence(database: MegumiDatabase, runId: string): number {
  const row = database.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM agent_loop_events WHERE run_id = ?')
    .get(runId) as { sequence: number };
  return row.sequence + 1;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
