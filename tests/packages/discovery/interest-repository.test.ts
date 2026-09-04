/*
 * Verifies Interest persistence queries and cross-table business transactions.
 */
// @vitest-environment node

import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createInterestRepository,
  type InterestRepository,
} from '../../../packages/agent/discovery/src/persistence/interest-repository';

describe('InterestRepository', () => {
  let database: DatabaseConnection;
  let repository: InterestRepository;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    repository = createInterestRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it('separates exact Interest queries from the non-deleted list', () => {
    const first = repository.applyInterestChange({
      action: 'create',
      interestId: 'interest:first',
      description: 'Distributed systems',
      now: '2026-09-03T08:00:00.000Z',
    });
    repository.applyInterestChange({
      action: 'create',
      interestId: 'interest:deleted',
      description: 'Old topic',
      now: '2026-09-03T08:01:00.000Z',
    });
    const deleted = repository.applyInterestChange({
      action: 'delete',
      interestId: 'interest:deleted',
      now: '2026-09-03T08:02:00.000Z',
    });

    expect(first).toHaveProperty('id', 'interest:first');
    expect(first).not.toHaveProperty('interestId');
    expect(repository.findInterestById(first.id)).toEqual(first);
    expect(repository.findInterestById('interest:missing')).toBeUndefined();
    expect(repository.listInterestsByIds([
      deleted.id,
      'interest:missing',
      first.id,
    ])).toEqual([first, deleted]);
    expect(repository.listInterestsByIds([])).toEqual([]);
    expect(repository.listNonDeletedInterests()).toEqual([first]);
  });

  it('separates exact Evidence queries from the pending list', () => {
    seedConversation(database);
    repository.applyInterestExtraction({
      sessionId: 'session:interest',
      messageId: 'message:user',
      now: '2026-09-03T09:00:00.000Z',
      evidence: [
        {
          evidenceId: 'evidence:applied',
          interestId: 'interest:created',
          description: 'TypeScript architecture',
          effect: 'support',
          confidence: 'high',
        },
        {
          evidenceId: 'evidence:pending',
          interestId: 'interest:unused',
          description: 'Database internals',
          effect: 'support',
          confidence: 'medium',
        },
      ],
    });

    const applied = repository.findInterestEvidenceById('evidence:applied');
    const pending = repository.findInterestEvidenceById('evidence:pending');
    expect(applied).toMatchObject({
      id: 'evidence:applied',
      interestId: 'interest:created',
      status: 'applied',
    });
    expect(pending).toMatchObject({
      id: 'evidence:pending',
      status: 'pending',
    });
    expect(repository.findInterestEvidenceById('evidence:missing')).toBeUndefined();
    expect(repository.listInterestEvidenceByIds([
      'evidence:pending',
      'evidence:missing',
      'evidence:applied',
    ])).toEqual([applied, pending]);
    expect(repository.listInterestEvidenceByIds([])).toEqual([]);
    expect(repository.listPendingInterestEvidence()).toEqual([pending]);
  });

  it('preserves Session Participation identity and retracts its Interest facts when excluded', () => {
    seedConversation(database);
    repository.applyInterestExtraction({
      sessionId: 'session:interest',
      messageId: 'message:user',
      now: '2026-09-03T09:00:00.000Z',
      evidence: [{
        evidenceId: 'evidence:session',
        interestId: 'interest:session',
        description: 'Agent evaluation systems',
        effect: 'support',
        confidence: 'high',
      }],
    });

    const included = repository.applyInterestSessionSettingChange({
      sessionId: 'session:interest',
      participation: 'included',
      effectiveFrom: '2026-09-03T09:01:00.000Z',
      updatedAt: '2026-09-03T09:01:00.000Z',
    });
    expect(included).toEqual({
      participation: {
        id: expect.any(String),
        sessionId: 'session:interest',
        participation: 'included',
        effectiveFrom: '2026-09-03T09:01:00.000Z',
        createdAt: '2026-09-03T09:01:00.000Z',
        updatedAt: '2026-09-03T09:01:00.000Z',
      },
      affectedInterestIds: [],
    });

    const excluded = repository.applyInterestSessionSettingChange({
      sessionId: 'session:interest',
      participation: 'excluded',
      effectiveFrom: '2026-09-03T09:02:00.000Z',
      updatedAt: '2026-09-03T09:02:00.000Z',
    });
    expect(excluded.participation).toEqual({
      ...included.participation,
      participation: 'excluded',
      effectiveFrom: '2026-09-03T09:02:00.000Z',
      updatedAt: '2026-09-03T09:02:00.000Z',
    });
    expect(excluded.affectedInterestIds).toEqual(['interest:session']);
    expect(repository.findInterestSessionSettingById(
      included.participation.id,
    )).toEqual(excluded.participation);
    expect(repository.findInterestSessionSettingBySessionId(
      'session:interest',
    )).toEqual(excluded.participation);
    expect(repository.findInterestEvidenceById('evidence:session')?.status).toBe(
      'retracted',
    );
    expect(repository.findInterestById('interest:session')?.status).toBe('deleted');
  });
});

function seedConversation(database: DatabaseConnection): void {
  database.prepare({ sql: `
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:interest', 'Interest', 'C:/workspaces/interest',
      'c:/workspaces/interest', 'available',
      '2026-09-03T08:00:00.000Z', '2026-09-03T08:00:00.000Z',
      '2026-09-03T08:00:00.000Z'
    )
  ` }).run();
  database.prepare({ sql: `
    INSERT INTO sessions (
      session_id, workspace_id, title, status, created_at, updated_at
    ) VALUES (
      'session:interest', 'workspace:interest', 'Interest', 'active',
      '2026-09-03T08:00:00.000Z', '2026-09-03T08:00:00.000Z'
    )
  ` }).run();
  database.prepare({ sql: `
    INSERT INTO session_messages (
      message_id, session_id, execution_id, message_kind, message_json,
      created_at, completed_at
    ) VALUES (
      'message:user', 'session:interest', 'execution:interest',
      'user_message', '{}', '2026-09-03T08:00:00.000Z', NULL
    )
  ` }).run();
}
