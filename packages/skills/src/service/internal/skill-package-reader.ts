/* Discovers Skill packages and deduplicates only identical normalized SKILL.md paths. */

import fs from 'node:fs';
import path from 'node:path';
import type { Skill, SkillDiagnostic, SkillOwner, SkillResource, SkillScript } from '../../domain/model/skill';
import { parseSkillManifest } from './skill-manifest-parser';

export type SkillRoot = {
  owner: SkillOwner;
  rootPath: string;
  excludedDirectoryNames?: string[];
};

export function readSkillPackages(input: { roots: SkillRoot[] }): Skill[] {
  const byPath = new Map<string, Skill>();
  for (const skill of input.roots.flatMap(readRootSkills)) {
    const key = comparablePath(skill.skillPath);
    if (!byPath.has(key)) byPath.set(key, skill);
  }
  return [...byPath.values()].sort((left, right) => (
    left.name.localeCompare(right.name) || left.skillPath.localeCompare(right.skillPath)
  ));
}

export function normalizeSkillPath(skillPath: string): string {
  const absolutePath = path.resolve(skillPath);
  try {
    return fs.realpathSync.native(absolutePath);
  } catch {
    return absolutePath;
  }
}

function readRootSkills(root: SkillRoot): Skill[] {
  if (!safeExistsDirectory(root.rootPath)) return [];
  return findSkillPaths(root.rootPath, new Set(root.excludedDirectoryNames ?? []))
    .flatMap((skillPath) => readSkillPackage(root, skillPath));
}

function findSkillPaths(rootPath: string, excludedDirectoryNames: ReadonlySet<string>): string[] {
  const skillPaths: string[] = [];
  const stack = [path.resolve(rootPath)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const manifestPath = path.join(current, 'SKILL.md');
    if (safeExistsFile(manifestPath)) {
      skillPaths.push(normalizeSkillPath(manifestPath));
      continue;
    }
    for (const child of safeReadDirectories(current)) {
      if (!excludedDirectoryNames.has(child)) stack.push(path.join(current, child));
    }
  }
  return skillPaths.sort();
}

function readSkillPackage(root: SkillRoot, skillPath: string): Skill[] {
  const parsed = parseSkillManifest({ filePath: skillPath, text: fs.readFileSync(skillPath, 'utf8') });
  if (!parsed.manifest) return [];
  const skillDirectory = path.dirname(skillPath);
  return [{
    name: parsed.manifest.name,
    description: parsed.manifest.description,
    skillPath,
    source: { owner: root.owner },
    content: parsed.manifest.content,
    resources: discoverResources(skillDirectory),
    scripts: discoverScripts(skillDirectory),
    diagnostics: parsed.diagnostics,
    available: true,
  }];
}

function discoverResources(skillDirectory: string): SkillResource[] {
  return [
    ...walkFiles(path.join(skillDirectory, 'references'), 'references')
      .map((resourcePath): SkillResource => ({ resourcePath, contentType: 'text' })),
    ...walkFiles(path.join(skillDirectory, 'assets'), 'assets')
      .map((resourcePath): SkillResource => ({ resourcePath, contentType: 'asset' })),
  ].sort((left, right) => left.resourcePath.localeCompare(right.resourcePath));
}

function discoverScripts(skillDirectory: string): SkillScript[] {
  return walkFiles(path.join(skillDirectory, 'scripts'), 'scripts').map((scriptPath) => ({
    name: path.basename(scriptPath, path.extname(scriptPath)),
    scriptPath,
  }));
}

function walkFiles(rootPath: string, relativeRoot: string): string[] {
  if (!safeExistsDirectory(rootPath)) return [];
  const output: string[] = [];
  const stack = [{ absolutePath: rootPath, relativePath: relativeRoot }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of safeReadEntries(current.absolutePath)) {
      const absolutePath = path.join(current.absolutePath, entry.name);
      const relativePath = normalizeSlash(path.join(current.relativePath, entry.name));
      if (entry.isDirectory()) stack.push({ absolutePath, relativePath });
      if (entry.isFile()) output.push(relativePath);
    }
  }
  return output.sort();
}

function comparablePath(value: string): string {
  const normalized = normalizeSkillPath(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function safeExistsDirectory(targetPath: string): boolean {
  try { return fs.statSync(targetPath).isDirectory(); } catch { return false; }
}

function safeExistsFile(targetPath: string): boolean {
  try { return fs.statSync(targetPath).isFile(); } catch { return false; }
}

function safeReadDirectories(targetPath: string): string[] {
  return safeReadEntries(targetPath).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function safeReadEntries(targetPath: string): fs.Dirent[] {
  try { return fs.readdirSync(targetPath, { withFileTypes: true }); } catch { return []; }
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, '/');
}
