/*
 * Owns the durable per-path Skill availability setting: the store Contract, the
 * Database-backed implementation and the merge rules that combine discovery facts
 * with persisted availability.
 *
 * Availability is keyed by normalized skillPath. No record means "enabled by
 * default". Records for missing files are cleaned only when their Root is
 * accessible, so a temporarily unavailable Home never loses user settings.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import type { Skill, SkillAvailability } from './skill';
import { throwIfAborted } from './skill';
import { comparableSkillPath, normalizeSkillPath, type SkillRoot } from './skill-loader';

export interface SkillAvailabilityStore {
  /** Finds one persisted availability row by its database identity. */
  findSkillAvailabilityById(
    skillAvailabilityId: string,
  ): SkillAvailability | undefined;
  /** Lists every persisted availability row in stable Skill-path order. */
  listAllSkillAvailability(): readonly SkillAvailability[];
  /** Creates or updates the row selected by the unique Skill path. */
  upsertSkillAvailability(input: {
    readonly skillPath: string;
    readonly available: boolean;
    readonly updatedAt: string;
  }): SkillAvailability;
  /** Deletes one persisted availability row by its database identity. */
  deleteSkillAvailabilityById(skillAvailabilityId: string): boolean;
}

type SkillAvailabilityRow = DatabaseRow & {
  skill_availability_id: string;
  skill_path: string;
  available: number;
  updated_at: string;
};

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

/** Applies persisted availability to discovered Skills; missing records default to enabled. */
export function mergeSkillAvailability(
  skills: readonly Skill[],
  records: readonly SkillAvailability[],
): readonly Skill[] {
  const byPath = new Map(records.map((record) => [comparableSkillPath(record.skillPath), record.available]));
  return skills.map((skill) => {
    const available = byPath.get(comparableSkillPath(skill.skillPath)) ?? true;
    return available === skill.available ? skill : { ...skill, available };
  });
}

/**
 * Returns availability records whose SKILL.md file is gone while their Root is
 * still accessible. Cleaned records must not be re-applied to a new Skill that
 * later reuses the same path.
 */
export function cleanupStaleAvailability(input: {
  roots: readonly SkillRoot[];
  records: readonly SkillAvailability[];
  signal?: AbortSignal;
}): readonly SkillAvailability[] {
  const realRoots: Array<{ root: SkillRoot; realPath: string }> = [];
  for (const root of input.roots) {
    try {
      realRoots.push({ root, realPath: fs.realpathSync.native(path.resolve(root.rootPath)) });
    } catch {
      // Root unavailable: keep records untouched.
    }
  }
  const stale: SkillAvailability[] = [];
  for (const record of input.records) {
    throwIfAborted(input.signal);
    const root = realRoots.find((candidate) => isInsideRoot(candidate.realPath, record.skillPath));
    if (!root) continue;
    try {
      if (!fs.statSync(record.skillPath).isFile()) stale.push(record);
    } catch {
      stale.push(record);
    }
  }
  return stale;
}

function availabilityFromRow(row: SkillAvailabilityRow): SkillAvailability {
  return {
    skillAvailabilityId: row.skill_availability_id,
    skillPath: row.skill_path,
    available: row.available === 1,
    updatedAt: row.updated_at,
  };
}

function isInsideRoot(realRoot: string, candidate: string): boolean {
  const relative = path.relative(realRoot, normalizeSkillPath(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
