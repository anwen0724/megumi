/*
 * Verifies the product's built-in study Skills load as real packages through the
 * Loader and carry System/global source facts without any run-time protocol fields.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SKILLS_POLICY, loadSkills } from '@megumi/skills/skill-loader';

const BUILT_IN_SKILLS_ROOT = path.resolve(
  process.cwd(),
  'packages',
  'agent',
  'skills',
  'built-in-skills',
);

const EXPECTED_STUDY_SKILLS = [
  'explain-problem',
  'generate-practice',
  'plan-study-session',
  'review-answer',
  'review-materials',
] as const;

function readBuiltInSkills() {
  return loadSkills({
    roots: [{ owner: 'system' as const, scope: 'global' as const, rootPath: BUILT_IN_SKILLS_ROOT }],
    policy: DEFAULT_SKILLS_POLICY,
  });
}

describe('built-in study Skills', () => {
  it('provides five distinct task-oriented Skill packages', () => {
    const result = readBuiltInSkills();

    expect(result.skills.map((skill) => skill.name).sort()).toEqual(EXPECTED_STUDY_SKILLS);
    for (const skill of result.skills) {
      expect(skill).toMatchObject({
        source: { owner: 'system', scope: 'global' },
        available: true,
        disableModelInvocation: false,
        diagnostics: [],
      });
      expect(skill.description.trim()).not.toBe('');
      expect(skill.content.trim()).not.toBe('');
    }
  });
});
