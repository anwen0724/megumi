import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSkillPackages } from '@megumi/coding-agent/skills/service/internal/skill-package-reader';

describe('readSkillPackages', () => {
  it('discovers only folders containing SKILL.md and reads package metadata', () => {
    const root = createTempRoot();
    writeSkill(root, 'checks', {
      name: 'checks:test',
      description: 'Run project checks',
      content: 'Use this for test workflows.',
      files: {
        'references/usage.md': 'Usage',
        'assets/logo.png': 'png',
        'scripts/check.ps1': 'Write-Host ok',
      },
    });
    fs.mkdirSync(path.join(root, 'not-a-skill'), { recursive: true });

    const skills = readSkillPackages({ roots: [{ kind: 'project', rootPath: root }] });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      skillId: 'checks:test',
      name: 'checks:test',
      description: 'Run project checks',
      source: { kind: 'project', label: 'Project' },
      content: 'Use this for test workflows.\n',
      available: true,
    });
    expect(skills[0]?.resources.map((resource) => resource.resourcePath)).toEqual([
      'assets/logo.png',
      'references/usage.md',
    ]);
    expect(skills[0]?.scripts.map((script) => script.scriptPath)).toEqual(['scripts/check.ps1']);
  });

  it('uses SKILL.md name as skillId independent of source priority', () => {
    const systemRoot = createTempRoot();
    writeSkill(systemRoot, 'brainstorming', {
      name: 'superpowers:brainstorming',
      description: 'Explore intent',
      content: 'System copy',
    });

    const skills = readSkillPackages({ roots: [{ kind: 'system', rootPath: systemRoot }] });

    expect(skills[0]?.skillId).toBe('superpowers:brainstorming');
    expect(skills[0]?.skillId).not.toContain('system');
  });

  it('keeps the highest priority copy for the same skillId and records hidden copy diagnostics', () => {
    const systemRoot = createTempRoot();
    const userRoot = createTempRoot();
    const projectRoot = createTempRoot();
    for (const [root, content] of [[systemRoot, 'System copy'], [userRoot, 'User copy'], [projectRoot, 'Project copy']] as const) {
      writeSkill(root, 'brainstorming', {
        name: 'superpowers:brainstorming',
        description: 'Explore intent',
        content,
      });
    }

    const skills = readSkillPackages({
      roots: [
        { kind: 'system', rootPath: systemRoot },
        { kind: 'user', rootPath: userRoot },
        { kind: 'project', rootPath: projectRoot },
      ],
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.source.kind).toBe('project');
    expect(skills[0]?.content).toBe('Project copy\n');
    expect(skills[0]?.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain('Hidden lower-priority');
  });

  it('keeps different skills at the same priority even when display command names match', () => {
    const projectRoot = createTempRoot();
    writeSkill(projectRoot, 'package-a', {
      name: 'packages-a:test',
      description: 'Run test',
      content: 'A',
    });
    writeSkill(projectRoot, 'package-b', {
      name: 'packages-b:test',
      description: 'Run test',
      content: 'B',
    });

    const skills = readSkillPackages({ roots: [{ kind: 'project', rootPath: projectRoot }] });

    expect(skills.map((skill) => skill.skillId).sort()).toEqual(['packages-a:test', 'packages-b:test']);
  });

  it('allows user roots to skip the .system directory', () => {
    const userRoot = createTempRoot();
    writeSkill(userRoot, 'user-smoke', {
      name: 'user-smoke',
      description: 'User smoke',
      content: 'User copy',
    });
    writeSkill(path.join(userRoot, '.system'), 'system-smoke', {
      name: 'system-smoke',
      description: 'System smoke',
      content: 'System copy',
    });

    const skills = readSkillPackages({
      roots: [{
        kind: 'user',
        rootPath: userRoot,
        excludedDirectoryNames: ['.system'],
      }],
    });

    expect(skills.map((skill) => skill.skillId)).toEqual(['user-smoke']);
  });
});

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-skills-'));
  tempRootsForCleanup.push(root);
  return root;
}

const tempRootsForCleanup: string[] = [];

function writeSkill(root: string, packageName: string, input: {
  name: string;
  description: string;
  content: string;
  files?: Record<string, string>;
}): void {
  const packagePath = path.join(root, packageName);
  fs.mkdirSync(packagePath, { recursive: true });
  fs.writeFileSync(path.join(packagePath, 'SKILL.md'), [
    '---',
    `name: ${input.name}`,
    `description: ${input.description}`,
    '---',
    '',
    input.content,
    '',
  ].join('\n'));

  for (const [relativePath, content] of Object.entries(input.files ?? {})) {
    const filePath = path.join(packagePath, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

beforeEach(() => {
  tempRootsForCleanup.length = 0;
});

afterEach(() => {
  for (const root of tempRootsForCleanup.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
