/* Verifies each Candidate Pool check has an independently queryable durable settlement. */
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import { createDiscoveryRepository } from '@megumi/discovery';

describe('Candidate Supply Check repository', () => {
  let database: DatabaseConnection | undefined;
  afterEach(() => database?.close());

  it('records a no-gap check as successful work rather than absence of work', () => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    const repository = createDiscoveryRepository({ database });
    repository.createSupplyCheck({
      candidateSupplyId: 'candidate-supply:1',
      trigger: 'evaluation',
      status: 'queued',
      requestedAt: '2026-01-01T00:00:00.000Z',
    });
    repository.updateSupplyCheck({
      candidateSupplyId: 'candidate-supply:1',
      trigger: 'evaluation',
      status: 'completed',
      reason: 'no_gap',
      requestedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      availableBefore: 12,
      availableAfter: 12,
    });
    expect(repository.getSupplyCheck('candidate-supply:1')).toMatchObject({
      status: 'completed', reason: 'no_gap', availableAfter: 12,
    });
  });
});
