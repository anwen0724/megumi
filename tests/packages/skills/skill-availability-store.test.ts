/*
 * Verifies the durable Skill availability repository contract against SQLite.
 */

import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseSkillAvailabilityStore,
  type SkillAvailabilityStore,
} from '../../../packages/agent/skills/src/skill-availability';

describe('SkillAvailabilityStore', () => {
  let database: DatabaseConnection;
  let store: SkillAvailabilityStore;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    store = createDatabaseSkillAvailabilityStore(database);
  });

  afterEach(() => {
    database.close();
  });

  it('returns the persisted entity, preserves its ID on upsert, and finds it by ID', () => {
    const created = store.upsertSkillAvailability({
      skillPath: 'C:/skills/research/SKILL.md',
      available: false,
      updatedAt: '2026-09-03T10:00:00.000Z',
    });

    expect(created).toEqual({
      skillAvailabilityId: expect.stringMatching(/^skill-availability:/),
      skillPath: 'C:/skills/research/SKILL.md',
      available: false,
      updatedAt: '2026-09-03T10:00:00.000Z',
    });
    const updated = store.upsertSkillAvailability({
      skillPath: created.skillPath,
      available: true,
      updatedAt: '2026-09-03T11:00:00.000Z',
    });
    expect(updated).toEqual({
      skillAvailabilityId: created.skillAvailabilityId,
      skillPath: created.skillPath,
      available: true,
      updatedAt: '2026-09-03T11:00:00.000Z',
    });
    expect(
      store.findSkillAvailabilityById(created.skillAvailabilityId),
    ).toEqual(updated);
    expect(store.findSkillAvailabilityById('skill-availability:missing')).toBe(
      undefined,
    );
  });

  it('lists all rows by Skill path and deletes one row by its ID', () => {
    const zeta = store.upsertSkillAvailability({
      skillPath: 'C:/skills/zeta/SKILL.md',
      available: false,
      updatedAt: '2026-09-03T10:00:00.000Z',
    });
    const alpha = store.upsertSkillAvailability({
      skillPath: 'C:/skills/alpha/SKILL.md',
      available: true,
      updatedAt: '2026-09-03T10:01:00.000Z',
    });

    expect(store.listAllSkillAvailability()).toEqual([alpha, zeta]);
    expect(store.deleteSkillAvailabilityById(alpha.skillAvailabilityId)).toBe(
      true,
    );
    expect(store.findSkillAvailabilityById(alpha.skillAvailabilityId)).toBe(
      undefined,
    );
    expect(store.deleteSkillAvailabilityById(alpha.skillAvailabilityId)).toBe(
      false,
    );
    expect(store.listAllSkillAvailability()).toEqual([zeta]);

    expect(store).not.toHaveProperty('find');
    expect(store).not.toHaveProperty('list');
    expect(store).not.toHaveProperty('save');
    expect(store).not.toHaveProperty('delete');
  });
});
