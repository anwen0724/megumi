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
      expect(skill.description.trim().length).toBeGreaterThan(20);
      expect(skill.content.trim().length).toBeGreaterThan(200);
    }
  });

  it('gives each Skill a trigger description and task-specific workflow', () => {
    const skills = new Map(readBuiltInSkills().skills.map((skill) => [skill.name, skill]));

    expect(skills.get('explain-problem')).toMatchObject({
      description: expect.stringMatching(/题目|知识点/),
      content: expect.stringMatching(/提示[\s\S]*完整讲解|完整讲解[\s\S]*提示/),
    });
    expect(skills.get('review-answer')).toMatchObject({
      description: expect.stringMatching(/作答|答案/),
      content: expect.stringMatching(/第一个实质错误/),
    });
    expect(skills.get('generate-practice')).toMatchObject({
      description: expect.stringMatching(/练习/),
      content: expect.stringMatching(/答案[\s\S]*解析|解析[\s\S]*答案/),
    });
    expect(skills.get('review-materials')).toMatchObject({
      description: expect.stringMatching(/资料|笔记/),
      content: expect.stringMatching(/冲突[\s\S]*不确定|不确定[\s\S]*冲突/),
    });
    expect(skills.get('plan-study-session')).toMatchObject({
      description: expect.stringMatching(/时间|安排/),
      content: expect.stringMatching(/完成标准/),
    });
  });

  it('exposes only model facts: no resources, scripts or execution protocols', () => {
    for (const skill of readBuiltInSkills().skills) {
      expect(skill).not.toHaveProperty('resources');
      expect(skill).not.toHaveProperty('scripts');
      expect(skill).not.toHaveProperty('skillId');
      expect(skill.skillPath.endsWith('SKILL.md')).toBe(true);
      expect(path.isAbsolute(skill.packagePath)).toBe(true);
    }
  });
});
