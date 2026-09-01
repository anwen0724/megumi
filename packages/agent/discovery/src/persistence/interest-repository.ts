/*
 * Owns durable Interest, Evidence, and Session participation transactions.
 */
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import {
  InterestDescriptionSchema,
  InterestEvidenceSchema,
  InterestSchema,
  SessionParticipationSchema,
  type Interest,
  type InterestEvidence,
  type SessionParticipation,
} from '../interests/interest';
import {
  InterestUnderstandingSchema,
  type InterestUnderstanding,
} from '../interests/interest-understanding';

export type ValidatedInterestCommand =
  | { readonly action: 'create'; readonly interestId: string; readonly description: string; readonly now: string }
  | { readonly action: 'update'; readonly interestId: string; readonly description: string; readonly now: string }
  | { readonly action: 'pause' | 'resume' | 'delete'; readonly interestId: string; readonly now: string };

export interface ApplyInterestExtraction {
  readonly sessionId: string;
  readonly messageId: string;
  readonly now: string;
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly interestId: string;
    readonly description: string;
    readonly effect: 'support' | 'reject';
    readonly confidence: 'high' | 'medium';
    readonly matchedInterestId?: string;
    readonly supportingEvidenceIds?: readonly string[];
  }[];
}

export interface InterestRepository {
  /** Creates the durable receipt before work enters the in-memory queue. */
  createInterestUnderstanding(operation: InterestUnderstanding): InterestUnderstanding;
  /** Persists one status transition for an existing Interest Understanding. */
  updateInterestUnderstanding(operation: InterestUnderstanding): InterestUnderstanding;
  getInterestUnderstanding(interestUnderstandingId: string): InterestUnderstanding | undefined;
  findInterestUnderstandingByExecution(executionId: string): InterestUnderstanding | undefined;
  interruptRunningInterestUnderstandings(input: { readonly interruptedAt: string }): number;
  /** Applies one user-owned Interest command atomically. */
  changeInterest(command: ValidatedInterestCommand): Interest;
  /** Lists durable non-deleted Interests in stable order. */
  listInterests(): readonly Interest[];
  /** Lists Evidence that has not yet formed or changed an Interest. */
  listPendingEvidence(): readonly InterestEvidence[];
  /** Applies one validated extraction result with its Evidence changes atomically. */
  applyInterestExtraction(command: ApplyInterestExtraction): readonly Interest[];
  /** Reads the current conversation participation policy. */
  getSessionParticipation(sessionId: string): SessionParticipation | undefined;
  /** Replaces the current conversation participation policy atomically. */
  setSessionParticipation(command: {
    readonly sessionId: string;
    readonly participation: 'included' | 'excluded';
    readonly effectiveFrom: string;
    readonly updatedAt: string;
  }): SessionParticipation;
  /** Retracts a Session's Evidence and removes unsupported inferred Interests atomically. */
  retractSessionEvidence(sessionId: string, retractedAt: string): readonly string[];
}

/** Creates the Interest persistence implementation over one Database connection. */
export function createInterestRepository(database: DatabaseConnection): InterestRepository {
  return {
    createInterestUnderstanding: (operation) => createInterestUnderstanding(database, operation),
    updateInterestUnderstanding: (operation) => updateInterestUnderstanding(database, operation),
    getInterestUnderstanding: (id) => readInterestUnderstanding(database, 'interest_understanding_id', id),
    findInterestUnderstandingByExecution: (id) => readInterestUnderstanding(database, 'execution_id', id),
    interruptRunningInterestUnderstandings: ({ interruptedAt }) => database.prepare({ sql: `
      UPDATE discovery_interest_understandings
      SET status = 'interrupted', completed_at = ?, failure_code = 'process_interrupted',
          failure_message = 'Interest Understanding was interrupted before completion.'
      WHERE status IN ('queued', 'running')
    ` }).run([interruptedAt]).changes,
    changeInterest: (command) => database.transaction({
      operation: () => changeInterest(database, command),
    }),
    listInterests: () => database.prepare<InterestRow>({ sql: `
      SELECT * FROM discovery_interests
      WHERE status <> 'deleted'
      ORDER BY created_at, interest_id
    ` }).all().map(interestFromRow),
    listPendingEvidence: () => database.prepare<EvidenceRow>({ sql: `
      SELECT * FROM discovery_interest_evidence
      WHERE status = 'pending'
      ORDER BY created_at, evidence_id
    ` }).all().map(evidenceFromRow),
    applyInterestExtraction: (command) => database.transaction({
      operation: () => applyInterestExtraction(database, command),
    }),
    getSessionParticipation(sessionId) {
      const row = database.prepare<SessionParticipationRow>({
        sql: 'SELECT * FROM discovery_session_policies WHERE session_id = ?',
      }).get([sessionId]);
      return row ? participationFromRow(row) : undefined;
    },
    setSessionParticipation: (command) => database.transaction({
      operation: () => {
        database.prepare({ sql: `
          INSERT INTO discovery_session_policies (
            session_id, participation, effective_from, updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            participation = excluded.participation,
            effective_from = excluded.effective_from,
            updated_at = excluded.updated_at
        ` }).run([
          command.sessionId,
          command.participation,
          command.effectiveFrom,
          command.updatedAt,
        ]);
        return SessionParticipationSchema.parse(command);
      },
    }),
    retractSessionEvidence: (sessionId, retractedAt) => database.transaction({
      operation: () => retractSessionEvidence(database, sessionId, retractedAt),
    }),
  };
}

function createInterestUnderstanding(
  database: DatabaseConnection,
  rawOperation: InterestUnderstanding,
): InterestUnderstanding {
  const operation = InterestUnderstandingSchema.parse(rawOperation);
  database.prepare({ sql: `
    INSERT INTO discovery_interest_understandings (
      interest_understanding_id, execution_id, session_id, user_message_id,
      assistant_message_id, status, queued_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', ?)
  ` }).run([
    operation.interestUnderstandingId,
    operation.executionId,
    operation.sessionId,
    operation.userMessageId,
    operation.assistantMessageId,
    operation.queuedAt,
  ]);
  return readInterestUnderstandingRequired(database, operation.interestUnderstandingId);
}

function updateInterestUnderstanding(
  database: DatabaseConnection,
  rawOperation: InterestUnderstanding,
): InterestUnderstanding {
  const operation = InterestUnderstandingSchema.parse(rawOperation);
  const changedInterestIds = operation.status === 'completed' ? operation.changedInterestIds : [];
  const evidenceIds = operation.status === 'completed' ? operation.evidenceIds : [];
  const outcome = operation.status === 'completed' ? operation.outcome : null;
  const failure = operation.status === 'failed' || operation.status === 'interrupted'
    ? operation.failure
    : undefined;
  const completedAt = operation.status === 'completed'
    || operation.status === 'failed'
    || operation.status === 'interrupted'
    ? operation.completedAt
    : null;
  const result = database.prepare({ sql: `
    UPDATE discovery_interest_understandings
    SET status = ?, outcome = ?, changed_interest_ids_json = ?, evidence_ids_json = ?,
        started_at = ?, completed_at = ?, failure_code = ?, failure_message = ?
    WHERE interest_understanding_id = ?
  ` }).run([
    operation.status,
    outcome,
    JSON.stringify(changedInterestIds),
    JSON.stringify(evidenceIds),
    operation.status === 'queued' ? null : operation.startedAt ?? null,
    completedAt,
    failure?.code ?? null,
    failure?.message ?? null,
    operation.interestUnderstandingId,
  ]);
  if (result.changes !== 1) throw new Error('Interest Understanding was not found.');
  return readInterestUnderstandingRequired(database, operation.interestUnderstandingId);
}

function readInterestUnderstandingRequired(
  database: DatabaseConnection,
  interestUnderstandingId: string,
): InterestUnderstanding {
  const value = readInterestUnderstanding(database, 'interest_understanding_id', interestUnderstandingId);
  if (!value) throw new Error('Interest Understanding was not found.');
  return value;
}

function readInterestUnderstanding(
  database: DatabaseConnection,
  column: 'interest_understanding_id' | 'execution_id',
  value: string,
): InterestUnderstanding | undefined {
  const row = database.prepare<InterestUnderstandingRow>({
    sql: `SELECT * FROM discovery_interest_understandings WHERE ${column} = ?`,
  }).get([value]);
  if (!row) return undefined;
  const base = {
    interestUnderstandingId: row.interest_understanding_id,
    executionId: row.execution_id,
    sessionId: row.session_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    queuedAt: row.queued_at,
  } as const;
  if (row.status === 'queued') return InterestUnderstandingSchema.parse({ ...base, status: 'queued' });
  if (row.status === 'running') {
    return InterestUnderstandingSchema.parse({ ...base, status: 'running', startedAt: row.started_at });
  }
  if (row.status === 'completed') {
    return InterestUnderstandingSchema.parse({
      ...base,
      status: 'completed',
      outcome: row.outcome,
      changedInterestIds: JSON.parse(row.changed_interest_ids_json),
      evidenceIds: JSON.parse(row.evidence_ids_json),
      startedAt: row.started_at,
      completedAt: row.completed_at,
    });
  }
  return InterestUnderstandingSchema.parse({
    ...base,
    status: row.status,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    completedAt: row.completed_at,
    failure: { code: row.failure_code, message: row.failure_message },
  });
}

/** Applies one already-validated Interest state transition inside the caller transaction. */
function changeInterest(database: DatabaseConnection, command: ValidatedInterestCommand): Interest {
  if (command.action === 'create') {
    const description = InterestDescriptionSchema.parse(command.description);
    database.prepare({ sql: `
      INSERT INTO discovery_interests (
        interest_id, description, status, created_from, user_managed_at,
        created_at, updated_at, revision
      ) VALUES (?, ?, 'active', 'manual', ?, ?, ?, 1)
    ` }).run([command.interestId, description, command.now, command.now, command.now]);
    return readInterestRequired(database, command.interestId);
  }

  const current = readInterestRequired(database, command.interestId);
  if (current.status === 'deleted') return current;
  if (command.action === 'update') {
    const description = InterestDescriptionSchema.parse(command.description);
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET description = ?, user_managed_at = ?, updated_at = ?, revision = revision + 1
      WHERE interest_id = ?
    ` }).run([description, command.now, command.now, command.interestId]);
  } else if (command.action === 'pause') {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'paused', paused_at = COALESCE(paused_at, ?),
          user_managed_at = ?, updated_at = ?, revision = revision + 1
      WHERE interest_id = ?
    ` }).run([command.now, command.now, command.now, command.interestId]);
  } else if (command.action === 'resume') {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'active', paused_at = NULL, user_managed_at = ?, updated_at = ?,
          revision = revision + 1
      WHERE interest_id = ?
    ` }).run([command.now, command.now, command.interestId]);
  } else {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'deleted', deleted_at = COALESCE(deleted_at, ?),
          user_managed_at = ?, updated_at = ?, revision = revision + 1
      WHERE interest_id = ?
    ` }).run([command.now, command.now, command.now, command.interestId]);
  }
  return readInterestRequired(database, command.interestId);
}

/** Applies extracted Evidence and its deterministic Interest effects in one transaction. */
function applyInterestExtraction(
  database: DatabaseConnection,
  command: ApplyInterestExtraction,
): readonly Interest[] {
  const affected = new Set<string>();
  for (const candidate of command.evidence) {
    const description = InterestDescriptionSchema.parse(candidate.description);
    const matched = candidate.matchedInterestId
      ? readInterest(database, candidate.matchedInterestId)
      : undefined;
    if (candidate.matchedInterestId && (!matched || matched.status === 'deleted')) {
      throw new Error('Interest extraction referenced an unavailable Interest.');
    }

    const supporting = (candidate.supportingEvidenceIds ?? []).map((evidenceId) => {
      const evidence = readEvidence(database, evidenceId);
      if (!evidence || evidence.status !== 'pending' || evidence.messageId === command.messageId) {
        throw new Error('Interest extraction referenced unavailable supporting Evidence.');
      }
      return evidence;
    });

    let interest = matched;
    if (!interest && supporting.length > 0) {
      const supportingInterestIds = new Set(
        supporting.flatMap((evidence) => evidence.interestId ? [evidence.interestId] : []),
      );
      if (supportingInterestIds.size > 1) {
        throw new Error('Supporting Evidence refers to multiple Interests.');
      }
      const supportingInterestId = supportingInterestIds.values().next().value;
      interest = supportingInterestId ? readInterest(database, supportingInterestId) : undefined;
    }
    let status: 'pending' | 'applied' = 'pending';
    if (candidate.effect === 'support' && (candidate.confidence === 'high' || supporting.length > 0)) {
      if (!interest) {
        insertConversationInterest(database, candidate.interestId, description, command.now);
        interest = readInterestRequired(database, candidate.interestId);
      }
      status = 'applied';
      affected.add(interest.interestId);
      for (const evidence of supporting) {
        database.prepare({ sql: `
          UPDATE discovery_interest_evidence
          SET interest_id = ?, status = 'applied', applied_at = ?
          WHERE evidence_id = ? AND status = 'pending'
        ` }).run([interest.interestId, command.now, evidence.evidenceId]);
      }
    } else if (candidate.effect === 'reject' && candidate.confidence === 'high' && interest) {
      status = 'applied';
      affected.add(interest.interestId);
      if (!interest.userManagedAt) {
        database.prepare({ sql: `
          UPDATE discovery_interests
          SET status = 'paused', paused_at = COALESCE(paused_at, ?), updated_at = ?,
              revision = revision + 1
          WHERE interest_id = ? AND status <> 'deleted'
        ` }).run([command.now, command.now, interest.interestId]);
      }
    }

    database.prepare({ sql: `
      INSERT INTO discovery_interest_evidence (
        evidence_id, interest_id, session_id, message_id, description,
        effect, confidence, status, created_at, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ` }).run([
      candidate.evidenceId,
      interest?.interestId ?? null,
      command.sessionId,
      command.messageId,
      description,
      candidate.effect,
      candidate.confidence,
      status,
      command.now,
      status === 'applied' ? command.now : null,
    ]);
  }
  return [...affected].map((interestId) => readInterestRequired(database, interestId));
}

function insertConversationInterest(
  database: DatabaseConnection,
  interestId: string,
  description: string,
  now: string,
): void {
  database.prepare({ sql: `
    INSERT INTO discovery_interests (
      interest_id, description, status, created_from, created_at, updated_at, revision
    ) VALUES (?, ?, 'active', 'conversation', ?, ?, 1)
  ` }).run([interestId, description, now, now]);
}

/** Retracts one Session's Evidence and deletes inferred Interests that lose all support. */
function retractSessionEvidence(
  database: DatabaseConnection,
  sessionId: string,
  retractedAt: string,
): readonly string[] {
  const evidence = database.prepare<EvidenceRow>({ sql: `
    SELECT * FROM discovery_interest_evidence
    WHERE session_id = ? AND status <> 'retracted'
  ` }).all([sessionId]);
  const affected = new Set(evidence.flatMap((item) => item.interest_id ? [item.interest_id] : []));
  database.prepare({ sql: `
    UPDATE discovery_interest_evidence
    SET status = 'retracted', retracted_at = ?
    WHERE session_id = ? AND status <> 'retracted'
  ` }).run([retractedAt, sessionId]);
  for (const interestId of affected) {
    const interest = readInterest(database, interestId);
    if (!interest || interest.createdFrom !== 'conversation' || interest.userManagedAt) continue;
    const support = database.prepare<{ count: number }>({ sql: `
      SELECT COUNT(*) AS count FROM discovery_interest_evidence
      WHERE interest_id = ? AND status = 'applied' AND effect = 'support'
    ` }).get([interestId])?.count ?? 0;
    if (support === 0) {
      database.prepare({ sql: `
        UPDATE discovery_interests
        SET status = 'deleted', deleted_at = ?, updated_at = ?, revision = revision + 1
        WHERE interest_id = ? AND status <> 'deleted'
      ` }).run([retractedAt, retractedAt, interestId]);
    }
  }
  return [...affected].sort();
}

function readInterestRequired(database: DatabaseConnection, interestId: string): Interest {
  const interest = readInterest(database, interestId);
  if (!interest) throw new Error('Interest was not found.');
  return interest;
}

function readInterest(database: DatabaseConnection, interestId: string): Interest | undefined {
  const row = database.prepare<InterestRow>({
    sql: 'SELECT * FROM discovery_interests WHERE interest_id = ?',
  }).get([interestId]);
  return row ? interestFromRow(row) : undefined;
}

function readEvidence(database: DatabaseConnection, evidenceId: string): InterestEvidence | undefined {
  const row = database.prepare<EvidenceRow>({
    sql: 'SELECT * FROM discovery_interest_evidence WHERE evidence_id = ?',
  }).get([evidenceId]);
  return row ? evidenceFromRow(row) : undefined;
}

function interestFromRow(row: InterestRow): Interest {
  return InterestSchema.parse({
    interestId: row.interest_id,
    description: row.description,
    status: row.status,
    createdFrom: row.created_from,
    revision: row.revision,
    ...(row.user_managed_at ? { userManagedAt: row.user_managed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.paused_at ? { pausedAt: row.paused_at } : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  });
}

function evidenceFromRow(row: EvidenceRow): InterestEvidence {
  return InterestEvidenceSchema.parse({
    evidenceId: row.evidence_id,
    ...(row.interest_id ? { interestId: row.interest_id } : {}),
    sessionId: row.session_id,
    messageId: row.message_id,
    description: row.description,
    effect: row.effect,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
    ...(row.applied_at ? { appliedAt: row.applied_at } : {}),
    ...(row.retracted_at ? { retractedAt: row.retracted_at } : {}),
  });
}

function participationFromRow(row: SessionParticipationRow): SessionParticipation {
  return SessionParticipationSchema.parse({
    sessionId: row.session_id,
    participation: row.participation,
    effectiveFrom: row.effective_from,
    updatedAt: row.updated_at,
  });
}

type InterestRow = DatabaseRow & {
  interest_id: string;
  description: string;
  status: string;
  created_from: string;
  revision: number;
  user_managed_at: string | null;
  created_at: string;
  updated_at: string;
  paused_at: string | null;
  deleted_at: string | null;
};

type EvidenceRow = DatabaseRow & {
  evidence_id: string;
  interest_id: string | null;
  session_id: string;
  message_id: string;
  description: string;
  effect: string;
  confidence: string;
  status: string;
  created_at: string;
  applied_at: string | null;
  retracted_at: string | null;
};

type SessionParticipationRow = DatabaseRow & {
  session_id: string;
  participation: string;
  effective_from: string;
  updated_at: string;
};

type InterestUnderstandingRow = DatabaseRow & {
  interest_understanding_id: string;
  execution_id: string;
  session_id: string;
  user_message_id: string;
  assistant_message_id: string;
  status: string;
  outcome: string | null;
  changed_interest_ids_json: string;
  evidence_ids_json: string;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
};
