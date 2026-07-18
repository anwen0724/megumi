/*
 * Skill-owned repository for durable availability persistence.
 */

import type { MegumiDatabase } from '../../persistence/connection';
import type { SkillAvailability } from '../domain/entity/skill-availability';

type SkillAvailabilityRow = {
  skill_availability_id: string;
  skill_id: string;
  workspace_id: string | null;
  available: number;
  created_at: string;
  updated_at: string;
};

export class SkillRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveAvailability(availability: SkillAvailability): SkillAvailability {
    const existing = this.findAvailability({
      skillId: availability.skillId,
      ...(availability.workspaceId ? { workspaceId: availability.workspaceId } : {}),
    });
    if (existing) {
      this.database.prepare(`
        UPDATE skill_availability
        SET available = @available,
            updated_at = @updated_at
        WHERE skill_availability_id = @skill_availability_id
      `).run({
        skill_availability_id: existing.skillAvailabilityId,
        available: availability.available ? 1 : 0,
        updated_at: availability.updatedAt,
      });
      return this.findAvailabilityById(existing.skillAvailabilityId) ?? {
        ...availability,
        skillAvailabilityId: existing.skillAvailabilityId,
        createdAt: existing.createdAt,
      };
    }

    this.database.prepare(`
      INSERT INTO skill_availability (
        skill_availability_id,
        skill_id,
        workspace_id,
        available,
        created_at,
        updated_at
      ) VALUES (
        @skill_availability_id,
        @skill_id,
        @workspace_id,
        @available,
        @created_at,
        @updated_at
      )
    `).run(rowFromAvailability(availability));
    return availability;
  }

  findAvailability(input: { skillId: string; workspaceId?: string }): SkillAvailability | undefined {
    const row = input.workspaceId
      ? this.database.prepare(`
          SELECT * FROM skill_availability
          WHERE skill_id = ? AND workspace_id = ?
        `).get(input.skillId, input.workspaceId) as SkillAvailabilityRow | undefined
      : this.database.prepare(`
          SELECT * FROM skill_availability
          WHERE skill_id = ? AND workspace_id IS NULL
        `).get(input.skillId) as SkillAvailabilityRow | undefined;
    return row ? availabilityFromRow(row) : undefined;
  }

  listAvailabilityByWorkspace(input: { workspaceId?: string }): SkillAvailability[] {
    const rows = input.workspaceId
      ? this.database.prepare(`
          SELECT * FROM skill_availability
          WHERE workspace_id IS NULL OR workspace_id = ?
          ORDER BY skill_id ASC, workspace_id ASC
        `).all(input.workspaceId) as SkillAvailabilityRow[]
      : this.database.prepare(`
          SELECT * FROM skill_availability
          WHERE workspace_id IS NULL
          ORDER BY skill_id ASC
        `).all() as SkillAvailabilityRow[];
    return rows.map(availabilityFromRow);
  }

  private findAvailabilityById(skillAvailabilityId: string): SkillAvailability | undefined {
    const row = this.database.prepare(`
      SELECT * FROM skill_availability
      WHERE skill_availability_id = ?
    `).get(skillAvailabilityId) as SkillAvailabilityRow | undefined;
    return row ? availabilityFromRow(row) : undefined;
  }
}

function rowFromAvailability(availability: SkillAvailability): SkillAvailabilityRow {
  return {
    skill_availability_id: availability.skillAvailabilityId,
    skill_id: availability.skillId,
    workspace_id: availability.workspaceId ?? null,
    available: availability.available ? 1 : 0,
    created_at: availability.createdAt,
    updated_at: availability.updatedAt,
  };
}

function availabilityFromRow(row: SkillAvailabilityRow): SkillAvailability {
  return {
    skillAvailabilityId: row.skill_availability_id,
    skillId: row.skill_id,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    available: row.available === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
