/*
 * Owns the durable per-path Skill availability setting: the store contract and the merge rules that combine discovery facts
 * with persisted availability.
 *
 * Availability is keyed by normalized skillPath. No record means "enabled by
 * default". Records for missing files are cleaned only when their Root is
 * accessible, so a temporarily unavailable Home never loses user settings.
 */

import fs from 'node:fs';
import path from 'node:path';
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

function isInsideRoot(realRoot: string, candidate: string): boolean {
  const relative = path.relative(realRoot, normalizeSkillPath(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
