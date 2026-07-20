/* Verifies path-based Skill discovery and same-name preservation. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSkillPackages } from '@megumi/skills/service/internal/skill-package-reader';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('readSkillPackages', () => {
  it('keeps same-name skills when their SKILL.md paths differ', () => {
    const first = createRoot('first');
    const second = createRoot('second');
    writeSkill(first, 'review', 'same-name', 'First description', 'First body');
    writeSkill(second, 'review', 'same-name', 'Second description', 'Second body');

    const skills = readSkillPackages({ roots: [
      { owner: 'system', rootPath: first },
      { owner: 'user', rootPath: second },
    ] });

    expect(skills).toHaveLength(2);
    expect(skills.map((skill) => skill.name)).toEqual(['same-name', 'same-name']);
    expect(new Set(skills.map((skill) => skill.skillPath)).size).toBe(2);
    expect(skills.map((skill) => skill.source.owner)).toEqual(['system', 'user']);
    expect(skills.every((skill) => !('skillId' in skill) && !('packagePath' in skill))).toBe(true);
  });

  it('deduplicates the same normalized SKILL.md discovered through repeated roots', () => {
    const root = createRoot('duplicate');
    writeSkill(root, 'one', 'one', 'Description', 'Body');
    const skills = readSkillPackages({ roots: [
      { owner: 'user', rootPath: root },
      { owner: 'user', rootPath: path.join(root, '.') },
    ] });
    expect(skills).toHaveLength(1);
    expect(path.isAbsolute(skills[0]!.skillPath)).toBe(true);
    expect(path.basename(skills[0]!.skillPath)).toBe('SKILL.md');
  });

  it('discovers resources and scripts relative to skillPath', () => {
    const root = createRoot('assets');
    const directory = writeSkill(root, 'tooling', 'tooling', 'Description', 'Body');
    fs.mkdirSync(path.join(directory, 'references'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'references', 'guide.md'), 'guide');
    fs.writeFileSync(path.join(directory, 'scripts', 'run.js'), 'console.log(1)');
    const [skill] = readSkillPackages({ roots: [{ owner: 'user', rootPath: root }] });
    expect(skill?.resources.map((item) => item.resourcePath)).toEqual(['references/guide.md']);
    expect(skill?.scripts.map((item) => item.scriptPath)).toEqual(['scripts/run.js']);
  });
});

function createRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `megumi-skill-${label}-`));
  roots.push(root);
  return root;
}

function writeSkill(root: string, directoryName: string, name: string, description: string, body: string): string {
  const directory = path.join(root, directoryName);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
  return directory;
}
