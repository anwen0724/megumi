/* Verifies SkillAvailability persistence by exact skillPath. */
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/agent/persistence';
import { applyAgentDatabaseMigrations } from '@megumi/agent/persistence/schema';
import { SkillRepository } from '@megumi/skills';

let database: MegumiDatabase | undefined;
afterEach(() => database?.close());

describe('SkillRepository', () => {
  it('upserts availability by skillPath without Workspace identity', () => {
    database = createDatabase();
    applyAgentDatabaseMigrations(database);
    const repository = new SkillRepository(database);
    repository.saveAvailability({
      skillAvailabilityId: 'availability:1',
      skillPath: 'C:/skills/one/SKILL.md',
      available: false,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    repository.saveAvailability({
      skillAvailabilityId: 'availability:replacement',
      skillPath: 'C:/skills/one/SKILL.md',
      available: true,
      updatedAt: '2026-07-20T01:00:00.000Z',
    });

    expect(repository.listAvailability()).toEqual([{
      skillAvailabilityId: 'availability:1',
      skillPath: 'C:/skills/one/SKILL.md',
      available: true,
      updatedAt: '2026-07-20T01:00:00.000Z',
    }]);
    const columns = database.prepare('PRAGMA table_info(skill_availability)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      'skill_availability_id', 'skill_path', 'available', 'updated_at',
    ]);
  });
});
