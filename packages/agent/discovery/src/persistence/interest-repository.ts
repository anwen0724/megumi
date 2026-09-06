/*
 * Owns durable Interest, Evidence, and Session participation transactions.
 */
import crypto from 'node:crypto';
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import {
  InterestDescriptionSchema,
  InterestEvidenceSchema,
  InterestSchema,
  InterestSessionSettingSchema,
  type Interest,
  type InterestEvidence,
  type InterestSessionSetting,
} from '../interests/interest';

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
  /** Finds one Interest by its database identity without hiding soft-deleted rows. */
  findInterestById(interestId: string): Interest | undefined;
  /** Lists the requested Interests, including soft-deleted rows, in stable creation order. */
  listInterestsByIds(interestIds: readonly string[]): readonly Interest[];
  /** Lists active and paused Interests in stable creation order. */
  listNonDeletedInterests(): readonly Interest[];
  /** Finds one Interest Evidence row by its database identity. */
  findInterestEvidenceById(evidenceId: string): InterestEvidence | undefined;
  /** Lists the requested Evidence rows in stable creation order. */
  listInterestEvidenceByIds(
    evidenceIds: readonly string[],
  ): readonly InterestEvidence[];
  /** Lists Evidence that has not yet formed or changed an Interest. */
  listPendingInterestEvidence(): readonly InterestEvidence[];
  /** Finds one Session Participation row by its database identity. */
  findInterestSessionSettingById(
    id: string,
  ): InterestSessionSetting | undefined;
  /** Finds the unique Participation policy associated with one Session. */
  findInterestSessionSettingBySessionId(
    sessionId: string,
  ): InterestSessionSetting | undefined;
  /** Applies one validated Interest command atomically. */
  applyInterestChange(command: ValidatedInterestCommand): Interest;
  /** Applies one validated extraction result with its Evidence changes atomically. */
  applyInterestExtraction(command: ApplyInterestExtraction): readonly Interest[];
  /** Applies a Participation change and any required Evidence retraction atomically. */
  applyInterestSessionSettingChange(command: {
    readonly sessionId: string;
    readonly participation: 'included' | 'excluded';
    readonly effectiveFrom: string;
    readonly updatedAt: string;
  }): {
    readonly participation: InterestSessionSetting;
    readonly affectedInterestIds: readonly string[];
  };
  /** Retracts a Session's Evidence and removes unsupported inferred Interests atomically. */
  retractSessionEvidence(input: {
    readonly sessionId: string;
    readonly retractedAt: string;
  }): readonly string[];
}

/** Creates the Interest persistence implementation over one Database connection. */
export function createInterestRepository(database: DatabaseConnection): InterestRepository {
  return {
    findInterestById: (interestId) => readInterest(database, interestId),
    listInterestsByIds(interestIds) {
      if (interestIds.length === 0) return [];
      const placeholders = interestIds.map(() => '?').join(', ');
      return database.prepare<InterestRow>({ sql: `
        SELECT * FROM discovery_interests
        WHERE id IN (${placeholders})
        ORDER BY created_at, id
      ` }).all(interestIds).map(interestFromRow);
    },
    listNonDeletedInterests: () => database.prepare<InterestRow>({ sql: `
      SELECT * FROM discovery_interests
      WHERE status <> 'deleted'
      ORDER BY created_at, id
    ` }).all().map(interestFromRow),
    findInterestEvidenceById: (evidenceId) => readEvidence(database, evidenceId),
    listInterestEvidenceByIds(evidenceIds) {
      if (evidenceIds.length === 0) return [];
      const placeholders = evidenceIds.map(() => '?').join(', ');
      return database.prepare<EvidenceRow>({ sql: `
        SELECT * FROM discovery_interest_evidence
        WHERE id IN (${placeholders})
        ORDER BY created_at, id
      ` }).all(evidenceIds).map(evidenceFromRow);
    },
    listPendingInterestEvidence: () => database.prepare<EvidenceRow>({ sql: `
      SELECT * FROM discovery_interest_evidence
      WHERE status = 'pending'
      ORDER BY created_at, id
    ` }).all().map(evidenceFromRow),
    findInterestSessionSettingById: (id) => (
      findInterestSessionSetting(database, 'id', id)
    ),
    findInterestSessionSettingBySessionId: (sessionId) => (
      findInterestSessionSetting(database, 'session_id', sessionId)
    ),
    applyInterestChange: (command) => database.transaction({
      operation: () => applyInterestChange(database, command),
    }),
    applyInterestExtraction: (command) => database.transaction({
      operation: () => applyInterestExtraction(database, command),
    }),
    applyInterestSessionSettingChange: (command) => database.transaction({
      operation: () => {
        upsertInterestSessionSetting(database, command);
        const participation = findInterestSessionSetting(
          database,
          'session_id',
          command.sessionId,
        );
        if (!participation) {
          throw new Error('Session Participation was not found after upsert.');
        }
        const affectedInterestIds = command.participation === 'excluded'
          ? retractSessionEvidence(database, command.sessionId, command.updatedAt)
          : [];
        return { participation, affectedInterestIds };
      },
    }),
    retractSessionEvidence: (input) => database.transaction({
      operation: () => retractSessionEvidence(database, input.sessionId, input.retractedAt),
    }),
  };
}

/** Applies one already-validated Interest state transition inside the caller transaction. */
function applyInterestChange(database: DatabaseConnection, command: ValidatedInterestCommand): Interest {
  if (command.action === 'create') {
    const description = InterestDescriptionSchema.parse(command.description);
    database.prepare({ sql: `
      INSERT INTO discovery_interests (
        id, description, status, created_from, user_managed_at,
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
      WHERE id = ?
    ` }).run([description, command.now, command.now, command.interestId]);
  } else if (command.action === 'pause') {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'paused', paused_at = COALESCE(paused_at, ?),
          user_managed_at = ?, updated_at = ?, revision = revision + 1
      WHERE id = ?
    ` }).run([command.now, command.now, command.now, command.interestId]);
  } else if (command.action === 'resume') {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'active', paused_at = NULL, user_managed_at = ?, updated_at = ?,
          revision = revision + 1
      WHERE id = ?
    ` }).run([command.now, command.now, command.interestId]);
  } else {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'deleted', deleted_at = COALESCE(deleted_at, ?),
          user_managed_at = ?, updated_at = ?, revision = revision + 1
      WHERE id = ?
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
      affected.add(interest.id);
      for (const evidence of supporting) {
        database.prepare({ sql: `
          UPDATE discovery_interest_evidence
          SET interest_id = ?, status = 'applied', applied_at = ?
          WHERE id = ? AND status = 'pending'
        ` }).run([interest.id, command.now, evidence.id]);
      }
    } else if (candidate.effect === 'reject' && candidate.confidence === 'high' && interest) {
      status = 'applied';
      affected.add(interest.id);
      if (!interest.userManagedAt) {
        database.prepare({ sql: `
          UPDATE discovery_interests
          SET status = 'paused', paused_at = COALESCE(paused_at, ?), updated_at = ?,
              revision = revision + 1
          WHERE id = ? AND status <> 'deleted'
        ` }).run([command.now, command.now, interest.id]);
      }
    }

    database.prepare({ sql: `
      INSERT INTO discovery_interest_evidence (
        id, interest_id, session_id, message_id, description,
        effect, confidence, status, created_at, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ` }).run([
      candidate.evidenceId,
      interest?.id ?? null,
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
      id, description, status, created_from, created_at, updated_at, revision
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
        WHERE id = ? AND status <> 'deleted'
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
    sql: 'SELECT * FROM discovery_interests WHERE id = ?',
  }).get([interestId]);
  return row ? interestFromRow(row) : undefined;
}

function readEvidence(database: DatabaseConnection, evidenceId: string): InterestEvidence | undefined {
  const row = database.prepare<EvidenceRow>({
    sql: 'SELECT * FROM discovery_interest_evidence WHERE id = ?',
  }).get([evidenceId]);
  return row ? evidenceFromRow(row) : undefined;
}

function interestFromRow(row: InterestRow): Interest {
  return InterestSchema.parse({
    id: row.id,
    description: row.description,
    status: row.status,
    createdFrom: row.created_from,
    revision: row.revision,
    ...(row.user_managed_at ? { userManagedAt: row.user_managed_at } : {}),
    ...(row.description_user_edited_at ? { descriptionUserEditedAt: row.description_user_edited_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.paused_at ? { pausedAt: row.paused_at } : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  });
}

function evidenceFromRow(row: EvidenceRow): InterestEvidence {
  return InterestEvidenceSchema.parse({
    id: row.id,
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

function participationFromRow(row: InterestSessionSettingRow): InterestSessionSetting {
  return InterestSessionSettingSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    participation: row.participation,
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

type InterestRow = DatabaseRow & {
  id: string;
  description: string;
  status: string;
  created_from: string;
  revision: number;
  user_managed_at: string | null;
  description_user_edited_at: string | null;
  created_at: string;
  updated_at: string;
  paused_at: string | null;
  deleted_at: string | null;
};

type EvidenceRow = DatabaseRow & {
  id: string;
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

type InterestSessionSettingRow = DatabaseRow & {
  id: string;
  session_id: string;
  participation: string;
  effective_from: string;
  created_at: string;
  updated_at: string;
};

function findInterestSessionSetting(
  database: DatabaseConnection,
  column: 'id' | 'session_id',
  value: string,
): InterestSessionSetting | undefined {
  const row = database.prepare<InterestSessionSettingRow>({
    sql: `SELECT * FROM discovery_interest_session_settings WHERE ${column} = ?`,
  }).get([value]);
  return row ? participationFromRow(row) : undefined;
}

/** Upserts one Session policy while preserving its existing database identity. */
function upsertInterestSessionSetting(
  database: DatabaseConnection,
  command: {
    readonly sessionId: string;
    readonly participation: 'included' | 'excluded';
    readonly effectiveFrom: string;
    readonly updatedAt: string;
  },
): void {
  database.prepare({ sql: `
    INSERT INTO discovery_interest_session_settings (
      id, session_id, participation, effective_from, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      participation = excluded.participation,
      effective_from = excluded.effective_from,
      updated_at = excluded.updated_at
  ` }).run([
    crypto.randomUUID(),
    command.sessionId,
    command.participation,
    command.effectiveFrom,
    command.updatedAt,
    command.updatedAt,
  ]);
}
