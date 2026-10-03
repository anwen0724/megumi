/* Persists skill availability through the application-owned database. */
import crypto from 'node:crypto';
import type { SkillAvailability, SkillAvailabilityStore } from '../skill-operations';
import type { DatabaseConnection, DatabaseRow } from './index';

type SkillAvailabilityRow = DatabaseRow & {
  skill_availability_id: string;
  skill_path: string;
  available: number;
  updated_at: string;
};

/** Creates the durable per-path availability adapter used by runtime Resources. */
export function createDatabaseSkillAvailabilityStore(database: DatabaseConnection): SkillAvailabilityStore {
  return {
    findSkillAvailabilityById(skillAvailabilityId) {
      const row = database.prepare<SkillAvailabilityRow>({
        sql: 'SELECT * FROM skill_availability WHERE skill_availability_id = ?',
      }).get([skillAvailabilityId]);
      return row ? availabilityFromRow(row) : undefined;
    },
    listAllSkillAvailability() {
      return database.prepare<SkillAvailabilityRow>({
        sql: 'SELECT * FROM skill_availability ORDER BY skill_path ASC',
      }).all().map(availabilityFromRow);
    },
    upsertSkillAvailability(input) {
      database.prepare({
        sql: `
          INSERT INTO skill_availability (
            skill_availability_id,
            skill_path,
            available,
            updated_at
          ) VALUES (
            @skill_availability_id,
            @skill_path,
            @available,
            @updated_at
          )
          ON CONFLICT(skill_path) DO UPDATE SET
            available = excluded.available,
            updated_at = excluded.updated_at
        `,
      }).run({
        skill_availability_id: `skill-availability:${crypto.randomUUID()}`,
        skill_path: input.skillPath,
        available: input.available ? 1 : 0,
        updated_at: input.updatedAt,
      });
      const row = database.prepare<SkillAvailabilityRow>({
        sql: 'SELECT * FROM skill_availability WHERE skill_path = ?',
      }).get([input.skillPath]);
      if (!row) {
        throw new Error('Persisted Skill availability row was not found.');
      }
      return availabilityFromRow(row);
    },
    deleteSkillAvailabilityById(skillAvailabilityId) {
      return database.prepare({
        sql: 'DELETE FROM skill_availability WHERE skill_availability_id = ?',
      }).run([skillAvailabilityId]).changes > 0;
    },
  };
}

function availabilityFromRow(row: SkillAvailabilityRow): SkillAvailability {
  return {
    skillAvailabilityId: row.skill_availability_id,
    skillPath: row.skill_path,
    available: row.available === 1,
    updatedAt: row.updated_at,
  };
}
