/* Verifies bounded, path-safe Skill discovery: ordering, deduplication, conflicts, ignore rules and limits. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  comparableSkillPath,
  DEFAULT_SKILLS_POLICY,
  loadSkills,
  validateSkillsPolicy,
  type SkillsPolicy,
  type SkillRoot,
} from '@megumi/skills/skill-loader';

const tempRoots: string[] = [];
afterEach(() => {
  tempRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe('loadSkills', () => {
  it('discovers Skills in stable Root order and stable path order within a Root', () => {
    const root = createRoot();
    const first = writeSkill(root, 'b-package', 'beta', 'Beta', 'Beta body');
    const second = writeSkill(root, 'a-package', 'alpha', 'Alpha', 'Alpha body');
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'global', rootPath: root }], policy: DEFAULT_SKILLS_POLICY });
    expect(result.skills.map((skill) => skill.skillPath)).toEqual([
      path.join(path.dirname(first), 'SKILL.md'),
      path.join(path.dirname(second), 'SKILL.md'),
    ].sort());
    expect(result.skills.map((skill) => skill.name)).toEqual(['alpha', 'beta']);
  });

  it('deduplicates the same real file discovered through repeated roots and symlinks', () => {
    const root = createRoot();
    const skillPath = writeSkill(root, 'one', 'one', 'Description', 'Body');
    const link = path.join(root, 'link');
    fs.symlinkSync(root, link, 'junction');
    const result = loadSkills({
      roots: [
        { owner: 'user', scope: 'global', rootPath: root },
        { owner: 'user', scope: 'global', rootPath: link },
      ],
      policy: DEFAULT_SKILLS_POLICY,
    });
    expect(result.skills).toHaveLength(1);
    expect(fs.realpathSync.native(result.skills[0]!.skillPath)).toBe(fs.realpathSync.native(skillPath));
  });

  it('keeps the first same-name Skill as the Winner and records a conflict diagnostic for the Loser', () => {
    const systemRoot = createRoot();
    const userRoot = createRoot();
    writeSkill(systemRoot, 'pkg', 'review-code', 'System description', 'System body');
    const loserPath = writeSkill(userRoot, 'pkg', 'review-code', 'User description', 'User body');
    const result = loadSkills({
      roots: [
        { owner: 'system', scope: 'global', rootPath: systemRoot },
        { owner: 'user', scope: 'global', rootPath: userRoot },
      ],
      policy: DEFAULT_SKILLS_POLICY,
    });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({ name: 'review-code', source: { owner: 'system' } });
    expect(result.diagnostics.some((diagnostic) =>
      diagnostic.code === 'name_conflict' && diagnostic.message.includes(loserPath))).toBe(true);
  });

  it('compares paths case-insensitively on Windows', () => {
    if (process.platform !== 'win32') return;
    expect(comparableSkillPath('C:/Workspace/SKILL.md')).toBe(comparableSkillPath('c:/workspace/skill.md'));
  });

  it('follows a directory symlink inside the Root and skips a symlink that escapes it', () => {
    const root = createRoot();
    const outside = createRoot();
    writeSkill(root, 'inside-package', 'inside', 'Inside', 'Body');
    const escapedPackage = path.join(outside, 'escaped-package');
    fs.mkdirSync(escapedPackage, { recursive: true });
    fs.writeFileSync(path.join(escapedPackage, 'SKILL.md'), '---\nname: escaped\ndescription: Escapes\n---\nBody\n');
    fs.symlinkSync(outside, path.join(root, 'outside-link'), 'junction');
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'global', rootPath: root }], policy: DEFAULT_SKILLS_POLICY });
    expect(result.skills.map((skill) => skill.name).sort()).toEqual(['inside']);
  });

  it('skips hidden directories, node_modules and ignore-file patterns', () => {
    const root = createRoot();
    writeSkill(root, 'visible', 'visible', 'Visible', 'Body');
    writeSkill(path.join(root, '.hidden'), 'ghost', 'ghost', 'Hidden', 'Body');
    writeSkill(path.join(root, 'node_modules'), 'dependency', 'dependency', 'Dependency', 'Body');
    writeSkill(path.join(root, 'ignored'), 'ignored', 'ignored', 'Ignored', 'Body');
    fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n');
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'global', rootPath: root }], policy: DEFAULT_SKILLS_POLICY });
    expect(result.skills.map((skill) => skill.name)).toEqual(['visible']);
  });

  it('stops scanning a Root when the directory limit is reached and keeps completed results', () => {
    const root = createRoot();
    writeSkill(root, 'a', 'a', 'A', 'Body');
    writeSkill(root, 'b', 'b', 'B', 'Body');
    const policy: SkillsPolicy = { ...DEFAULT_SKILLS_POLICY, maxScannedDirectoriesPerRoot: 1 };
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'global', rootPath: root }], policy });
    expect(result.skills.length).toBeLessThanOrEqual(1);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'scan_limited')).toBe(true);
  });

  it('stops scanning at the discovery count limit', () => {
    const root = createRoot();
    writeSkill(root, 'one', 'one', 'One', 'Body');
    writeSkill(root, 'two', 'two', 'Two', 'Body');
    const policy: SkillsPolicy = { ...DEFAULT_SKILLS_POLICY, maxDiscoveredSkillsPerRoot: 1 };
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'global', rootPath: root }], policy });
    expect(result.skills).toHaveLength(1);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'scan_limited')).toBe(true);
  });

  it('respects the scan depth limit', () => {
    const root = createRoot();
    writeSkill(path.join(root, 'deep', 'deeper', 'deepest'), 'deep-skill', 'deep-skill', 'Deep', 'Body');
    const shallowPolicy: SkillsPolicy = { ...DEFAULT_SKILLS_POLICY, maxScanDepth: 1 };
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'global', rootPath: root }], policy: shallowPolicy });
    expect(result.skills).toHaveLength(0);
  });

  it('excludes oversized manifests and content without silently truncating instructions', () => {
    const root = createRoot();
    const bigManifest = path.join(root, 'big-manifest');
    fs.mkdirSync(bigManifest, { recursive: true });
    fs.writeFileSync(path.join(bigManifest, 'SKILL.md'), '---\nname: big-manifest\ndescription: Big\n---\n' + 'x'.repeat(600));
    const bigContent = path.join(root, 'big-content');
    fs.mkdirSync(bigContent, { recursive: true });
    fs.writeFileSync(path.join(bigContent, 'SKILL.md'), '---\nname: big-content\ndescription: Big content\n---\n' + 'y'.repeat(300));
    const policy: SkillsPolicy = { ...DEFAULT_SKILLS_POLICY, maxManifestBytes: 512, maxContentCharacters: 64 };
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'global', rootPath: root }], policy });
    expect(result.skills).toHaveLength(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'skill_manifest_too_large')).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'skill_content_too_large')).toBe(true);
  });

  it('keeps valid Skills when another Skill in the same Root is broken', () => {
    const root = createRoot();
    writeSkill(root, 'valid', 'valid', 'Valid', 'Body');
    const broken = path.join(root, 'broken');
    fs.mkdirSync(broken, { recursive: true });
    fs.writeFileSync(path.join(broken, 'SKILL.md'), '---\nname: broken\n---\nNo description\n');
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'global', rootPath: root }], policy: DEFAULT_SKILLS_POLICY });
    expect(result.skills.map((skill) => skill.name)).toEqual(['valid']);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'manifest_missing_description')).toBe(true);
  });

  it('reports an absent Root as a normal empty scan and an unreadable Root as unavailable', () => {
    const missing = path.join(createRoot(), 'missing');
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'global', rootPath: missing }], policy: DEFAULT_SKILLS_POLICY });
    expect(result.scans[0]?.status).toBe('absent');
    expect(result.skills).toHaveLength(0);
  });

  it('treats a Root whose parent chain does not exist yet as absent, not unavailable', () => {
    // A workspace .megumi/skills Root before .megumi itself exists must be an
    // empty Root, never a root_unreadable error that pollutes diagnostics.
    const missingWorkspace = path.join(createRoot(), 'workspace', '.megumi', 'skills');
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'workspace', workspaceId: 'w', rootPath: missingWorkspace }], policy: DEFAULT_SKILLS_POLICY });
    expect(result.scans[0]?.status).toBe('absent');
    expect(result.scans[0]?.diagnostics).toHaveLength(0);
    expect(result.skills).toHaveLength(0);
  });

  it('applies ignore patterns to nested directories with platform separators', () => {
    const root = createRoot();
    writeSkill(root, 'visible', 'visible', 'Visible', 'Body');
    writeSkill(path.join(root, 'generated', 'deep'), 'nested-ignored', 'nested-ignored', 'Ignored', 'Body');
    fs.writeFileSync(path.join(root, '.gitignore'), 'generated/\n');
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'global', rootPath: root }], policy: DEFAULT_SKILLS_POLICY });
    expect(result.skills.map((skill) => skill.name)).toEqual(['visible']);
  });

  it('does not scan inside a package after its SKILL.md is found', () => {
    const root = createRoot();
    const packageDir = path.join(root, 'package');
    fs.mkdirSync(path.join(packageDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'SKILL.md'), '---\nname: package\ndescription: Package\n---\nBody\n');
    fs.writeFileSync(path.join(packageDir, 'nested', 'SKILL.md'), '---\nname: nested\ndescription: Nested\n---\nBody\n');
    const result = loadSkills({ roots: [{ owner: 'user', scope: 'global', rootPath: root }], policy: DEFAULT_SKILLS_POLICY });
    expect(result.skills.map((skill) => skill.name)).toEqual(['package']);
  });
});

describe('validateSkillsPolicy', () => {
  it('rejects non-positive limits and contradictory combinations', () => {
    expect(validateSkillsPolicy({ ...DEFAULT_SKILLS_POLICY, maxCatalogItems: 0 })).not.toHaveLength(0);
    expect(validateSkillsPolicy({
      ...DEFAULT_SKILLS_POLICY,
      maxScannedDirectoriesPerRoot: 5,
      maxDiscoveredSkillsPerRoot: 10,
    })).not.toHaveLength(0);
    expect(validateSkillsPolicy({ ...DEFAULT_SKILLS_POLICY })).toHaveLength(0);
  });

  it('pins the default limits so they cannot drift silently', () => {
    expect(DEFAULT_SKILLS_POLICY).toEqual({
      maxScanDepth: 6,
      maxScannedDirectoriesPerRoot: 2000,
      maxDiscoveredSkillsPerRoot: 2000,
      maxManifestBytes: 256 * 1024,
      maxContentCharacters: 64_000,
      maxCatalogItems: 64,
      maxCatalogDescriptionCharacters: 1024,
    });
  });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-skill-loader-'));
  tempRoots.push(root);
  return root;
}

function writeSkill(root: string, directoryName: string, name: string, description: string, body: string): string {
  const directory = path.join(root, directoryName);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
  return path.join(directory, 'SKILL.md');
}

export type { SkillRoot };
