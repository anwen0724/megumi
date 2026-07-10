/*
 * Discovers Skill packages from configured roots and applies source priority.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Skill, SkillDiagnostic, SkillResource, SkillScript, SkillSourceKind } from '../../domain/model/skill';
import { parseSkillManifest } from './skill-manifest-parser';

export type SkillRoot = {
  kind: SkillSourceKind;
  rootPath: string;
  excludedDirectoryNames?: string[];
};

const SOURCE_LABELS: Record<SkillSourceKind, string> = {
  system: 'System',
  user: 'User',
  project: 'Project',
};

const SOURCE_PRIORITY: Record<SkillSourceKind, number> = {
  system: 0,
  user: 1,
  project: 2,
};

export function readSkillPackages(input: {
  roots: SkillRoot[];
}): Skill[] {
  const discovered = input.roots.flatMap(readRootSkills);
  const bySkillId = new Map<string, Skill>();

  for (const skill of discovered.sort((left, right) => SOURCE_PRIORITY[right.source.kind] - SOURCE_PRIORITY[left.source.kind])) {
    const existing = bySkillId.get(skill.skillId);
    if (!existing) {
      bySkillId.set(skill.skillId, skill);
      continue;
    }

    if (SOURCE_PRIORITY[skill.source.kind] === SOURCE_PRIORITY[existing.source.kind]) {
      existing.diagnostics.push({
        level: 'error',
        message: `Duplicate skillId ${skill.skillId} at same source priority: ${skill.packagePath}`,
      });
      continue;
    }

    existing.diagnostics.push({
      level: 'info',
      message: `Hidden lower-priority ${skill.source.label} skill copy: ${skill.packagePath}`,
    });
  }

  return [...bySkillId.values()];
}

function readRootSkills(root: SkillRoot): Skill[] {
  if (!safeExistsDirectory(root.rootPath)) {
    return [];
  }

  return findPackageDirectories(root.rootPath, new Set(root.excludedDirectoryNames ?? []))
    .flatMap((packagePath) => readSkillPackage(root, packagePath));
}

function findPackageDirectories(rootPath: string, excludedDirectoryNames: ReadonlySet<string>): string[] {
  const packages: string[] = [];
  const stack = [path.resolve(rootPath)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (safeExistsFile(path.join(current, 'SKILL.md'))) {
      packages.push(current);
      continue;
    }
    for (const child of safeReadDirectories(current)) {
      if (excludedDirectoryNames.has(child)) {
        continue;
      }
      stack.push(path.join(current, child));
    }
  }
  return packages.sort();
}

function readSkillPackage(root: SkillRoot, packagePath: string): Skill[] {
  const manifestPath = path.join(packagePath, 'SKILL.md');
  const parsed = parseSkillManifest({
    filePath: manifestPath,
    text: fs.readFileSync(manifestPath, 'utf8'),
  });
  if (!parsed.manifest) {
    return [];
  }

  return [{
    skillId: parsed.manifest.name,
    name: parsed.manifest.name,
    description: parsed.manifest.description,
    source: {
      kind: root.kind,
      label: SOURCE_LABELS[root.kind],
      rootPath: root.rootPath,
    },
    packagePath,
    content: parsed.manifest.content,
    resources: discoverResources(packagePath),
    scripts: discoverScripts(packagePath),
    diagnostics: parsed.diagnostics,
    available: true,
  }];
}

function discoverResources(packagePath: string): SkillResource[] {
  return [
    ...walkFiles(path.join(packagePath, 'references'), 'references')
      .map((resourcePath): SkillResource => ({ resourcePath, contentType: 'text' })),
    ...walkFiles(path.join(packagePath, 'assets'), 'assets')
      .map((resourcePath): SkillResource => ({ resourcePath, contentType: 'asset' })),
  ].sort((left, right) => left.resourcePath.localeCompare(right.resourcePath));
}

function discoverScripts(packagePath: string): SkillScript[] {
  return walkFiles(path.join(packagePath, 'scripts'), 'scripts')
    .map((scriptPath): SkillScript => ({
      name: path.basename(scriptPath, path.extname(scriptPath)),
      scriptPath,
    }));
}

function walkFiles(rootPath: string, relativeRoot: string): string[] {
  if (!safeExistsDirectory(rootPath)) {
    return [];
  }
  const output: string[] = [];
  const stack: Array<{ absolutePath: string; relativePath: string }> = [{ absolutePath: rootPath, relativePath: relativeRoot }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of safeReadEntries(current.absolutePath)) {
      const absolutePath = path.join(current.absolutePath, entry.name);
      const relativePath = normalizeSlash(path.join(current.relativePath, entry.name));
      if (entry.isDirectory()) {
        stack.push({ absolutePath, relativePath });
        continue;
      }
      if (entry.isFile()) {
        output.push(relativePath);
      }
    }
  }
  return output.sort();
}

function safeExistsDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function safeExistsFile(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function safeReadDirectories(targetPath: string): string[] {
  return safeReadEntries(targetPath)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function safeReadEntries(targetPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, '/');
}
