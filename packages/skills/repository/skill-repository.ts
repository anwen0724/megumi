/* Persists and cleans sparse availability for exact SKILL.md paths. */

import type Database from 'better-sqlite3';
import type { SkillAvailability } from '../domain/entity/skill-availability';

export type SkillDatabase = Database.Database;

type SkillAvailabilityRow = {
  skill_availability_id: string;
  skill_path: string;
  available: number;
  updated_at: string;
};

export class SkillRepository {
  constructor(private readonly database: SkillDatabase) {}

  saveAvailability(availability: SkillAvailability): SkillAvailability {
    this.database.prepare(`
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
    `).run(rowFromAvailability(availability));
    return this.findAvailability({ skillPath: availability.skillPath }) ?? availability;
  }

  findAvailability(input: { skillPath: string }): SkillAvailability | undefined {
    const row = this.database.prepare(`
      SELECT * FROM skill_availability WHERE skill_path = ?
    `).get(input.skillPath) as SkillAvailabilityRow | undefined;
    return row ? availabilityFromRow(row) : undefined;
  }

  listAvailability(): SkillAvailability[] {
    const rows = this.database.prepare(`
      SELECT * FROM skill_availability ORDER BY skill_path ASC
    `).all() as SkillAvailabilityRow[];
    return rows.map(availabilityFromRow);
  }

  deleteAvailability(input: { skillPath: string }): boolean {
    return this.database.prepare(`
      DELETE FROM skill_availability WHERE skill_path = ?
    `).run(input.skillPath).changes > 0;
  }
}

function rowFromAvailability(availability: SkillAvailability): SkillAvailabilityRow {
  return {
    skill_availability_id: availability.skillAvailabilityId,
    skill_path: availability.skillPath,
    available: availability.available ? 1 : 0,
    updated_at: availability.updatedAt,
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
