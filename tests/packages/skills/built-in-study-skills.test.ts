/*
 * Verifies the product's built-in study Skills as real packages and confirms
 * they remain compatible with the existing slash-command projection.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSkillCommands } from '@megumi/agent/commands/core/skill-commands';
import { readSkillPackages } from '@megumi/skills/service/internal/skill-package-reader';

const BUILT_IN_SKILLS_ROOT = path.resolve(
  process.cwd(),
  'packages',
  'skills',
  'built-in-skills',
);

const EXPECTED_STUDY_SKILLS = [
  'explain-school-problem',
  'generate-study-practice',
  'plan-study-session',
  'review-student-answer',
  'review-study-materials',
] as const;

function readBuiltInSkills() {
  return readSkillPackages({
    roots: [{ owner: 'system' as const, rootPath: BUILT_IN_SKILLS_ROOT }],
  });
}

describe('built-in study Skills', () => {
  it('provides five distinct task-oriented Skill packages', () => {
    const skills = readBuiltInSkills();

    expect(skills.map((skill) => skill.name).sort()).toEqual(EXPECTED_STUDY_SKILLS);
    for (const skill of skills) {
      expect(skill).toMatchObject({
        source: { owner: 'system' },
        available: true,
        resources: [],
        scripts: [],
        diagnostics: [],
      });
      expect(skill.description.trim().length).toBeGreaterThan(20);
      expect(skill.content.trim().length).toBeGreaterThan(200);
    }
  });

  it('gives each Skill a trigger description and task-specific workflow', () => {
    const skills = new Map(readBuiltInSkills().map((skill) => [skill.name, skill]));

    expect(skills.get('explain-school-problem')).toMatchObject({
      description: expect.stringMatching(/题目|知识点/),
      content: expect.stringMatching(/提示[\s\S]*完整讲解|完整讲解[\s\S]*提示/),
    });
    expect(skills.get('review-student-answer')).toMatchObject({
      description: expect.stringMatching(/作答|答案/),
      content: expect.stringMatching(/第一个实质错误/),
    });
    expect(skills.get('generate-study-practice')).toMatchObject({
      description: expect.stringMatching(/练习/),
      content: expect.stringMatching(/答案[\s\S]*解析|解析[\s\S]*答案/),
    });
    expect(skills.get('review-study-materials')).toMatchObject({
      description: expect.stringMatching(/资料|笔记/),
      content: expect.stringMatching(/冲突[\s\S]*不确定|不确定[\s\S]*冲突/),
    });
    expect(skills.get('plan-study-session')).toMatchObject({
      description: expect.stringMatching(/时间|安排/),
      content: expect.stringMatching(/完成标准/),
    });
  });

  it('projects every Skill through the existing /skill command path', () => {
    const skills = readBuiltInSkills();
    const commands = createSkillCommands({
      skills: skills.map((skill) => ({
        name: skill.name,
        skillPath: skill.skillPath,
        description: skill.description,
        sourceLabel: 'System' as const,
      })),
    });

    expect(commands.slice(1).map((command) => ({
      name: command.name,
      source: command.source,
      selection: command.source.kind === 'skill'
        ? { type: 'skill', name: command.source.name, skillPath: command.source.skillPath }
        : undefined,
    }))).toEqual(EXPECTED_STUDY_SKILLS.map((skillName) => ({
      name: skillName,
      source: expect.objectContaining({ kind: 'skill', name: skillName }),
      selection: expect.objectContaining({ type: 'skill', name: skillName }),
    })));
  });
});
