/* Verifies atomic initialization and non-mutating snapshots at the Discovery boundary. */
// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@megumi/database';
import { getDiscoveryState, initializeDiscoveryState, type DiscoveryState } from '@megumi/discovery';

describe('Discovery state', () => {
  it('rejects dangling references atomically and never overwrites existing data', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      migrateDatabase({ database, migrationsFolder: path.resolve('packages/agent/database/migrations') });
      const empty = getDiscoveryState(database);
      const state: DiscoveryState = { ...empty, interests: [{
        id: 'interest', description: 'Agents', status: 'active', createdFrom: 'manual', revision: 0,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }] };
      expect(() => initializeDiscoveryState(database, { ...state, candidateInterestMatches: [{
        id: 'dangling', candidateId: 'missing', interestId: 'interest', relevance: 'direct', matchReason: 'Agent content',
      }] })).toThrow();
      expect(getDiscoveryState(database)).toEqual(empty);
      expect(initializeDiscoveryState(database, state)).toEqual(state);
      expect(() => initializeDiscoveryState(database, empty)).toThrow(/empty Discovery database/u);
      expect(getDiscoveryState(database)).toEqual(state);
    } finally { database.close(); }
  });
});
