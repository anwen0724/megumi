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
  retractSessionEvidence(sessionId: string, retractedAt: string): void;
}

/** Creates the Interest persistence implementation over one Database connection. */
export function createInterestRepository(database: DatabaseConnection): InterestRepository {
  return {
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

function changeInterest(database: DatabaseConnection, command: ValidatedInterestCommand): Interest {
  if (command.action === 'create') {
    const description = InterestDescriptionSchema.parse(command.description);
    database.prepare({ sql: `
      INSERT INTO discovery_interests (
        interest_id, description, status, created_from, user_managed_at,
        created_at, updated_at
      ) VALUES (?, ?, 'active', 'manual', ?, ?, ?)
    ` }).run([command.interestId, description, command.now, command.now, command.now]);
    return readInterestRequired(database, command.interestId);
  }

  const current = readInterestRequired(database, command.interestId);
  if (current.status === 'deleted') return current;
  if (command.action === 'update') {
    const description = InterestDescriptionSchema.parse(command.description);
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET description = ?, user_managed_at = ?, updated_at = ?
      WHERE interest_id = ?
    ` }).run([description, command.now, command.now, command.interestId]);
  } else if (command.action === 'pause') {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'paused', paused_at = COALESCE(paused_at, ?),
          user_managed_at = ?, updated_at = ?
      WHERE interest_id = ?
    ` }).run([command.now, command.now, command.now, command.interestId]);
  } else if (command.action === 'resume') {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'active', paused_at = NULL, user_managed_at = ?, updated_at = ?
      WHERE interest_id = ?
    ` }).run([command.now, command.now, command.interestId]);
  } else {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'deleted', deleted_at = COALESCE(deleted_at, ?),
          user_managed_at = ?, updated_at = ?
      WHERE interest_id = ?
    ` }).run([command.now, command.now, command.now, command.interestId]);
  }
  return readInterestRequired(database, command.interestId);
}

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
          SET status = 'paused', paused_at = COALESCE(paused_at, ?), updated_at = ?
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
      interest_id, description, status, created_from, created_at, updated_at
    ) VALUES (?, ?, 'active', 'conversation', ?, ?)
  ` }).run([interestId, description, now, now]);
}

function retractSessionEvidence(
  database: DatabaseConnection,
  sessionId: string,
  retractedAt: string,
): void {
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
        SET status = 'deleted', deleted_at = ?, updated_at = ?
        WHERE interest_id = ? AND status <> 'deleted'
      ` }).run([retractedAt, retractedAt, interestId]);
    }
  }
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
