/*
 * Discovers local Skill packages from ordered Roots with bounded, path-safe scanning.
 *
 * The loader owns path normalization, real-path containment, ignore rules, discovery
 * limits, deduplication and same-name conflict resolution. It never reads the Database
 * and never decides availability; Skills merges the loader candidates with availability.
 */

import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type { Skill, SkillDiagnostic, SkillOwner, SkillScope } from './skill';
import { parseSkillManifest } from './skill-manifest';
import { throwIfAborted } from './skill';

export interface SkillRoot {
  readonly owner: SkillOwner;
  readonly scope: SkillScope;
  readonly workspaceId?: string;
  readonly rootPath: string;
  readonly excludedDirectoryNames?: readonly string[];
}

export interface SkillsPolicy {
  readonly maxScanDepth: number;
  readonly maxScannedDirectoriesPerRoot: number;
  readonly maxDiscoveredSkillsPerRoot: number;
  readonly maxManifestBytes: number;
  readonly maxContentCharacters: number;
  readonly maxCatalogItems: number;
  readonly maxCatalogDescriptionCharacters: number;
}

export const DEFAULT_SKILLS_POLICY: Readonly<SkillsPolicy> = {
  maxScanDepth: 6,
  maxScannedDirectoriesPerRoot: 2000,
  maxDiscoveredSkillsPerRoot: 2000,
  maxManifestBytes: 256 * 1024,
  maxContentCharacters: 64_000,
  maxCatalogItems: 64,
  maxCatalogDescriptionCharacters: 1024,
} as const;

export type SkillRootScanStatus = 'ok' | 'absent' | 'unavailable';

export interface SkillRootScan {
  readonly status: SkillRootScanStatus;
  readonly skills: readonly Skill[];
  readonly diagnostics: readonly SkillDiagnostic[];
}

export interface SkillLoadResult {
  /** Conflict-resolved valid Skills in stable Root order; losers are excluded. */
  readonly skills: readonly Skill[];
  readonly diagnostics: readonly SkillDiagnostic[];
  /** One entry per input Root, aligned by index. */
  readonly scans: readonly SkillRootScan[];
}

export interface LoadSkillsInput {
  readonly roots: readonly SkillRoot[];
  readonly policy: Readonly<SkillsPolicy>;
  readonly signal?: AbortSignal;
}

/** Normalizes a path to an absolute real path; falls back to the resolved path when unreadable. */
export function normalizeSkillPath(skillPath: string): string {
  const absolutePath = path.resolve(skillPath);
  try {
    return fs.realpathSync.native(absolutePath);
  } catch {
    return absolutePath;
  }
}

/** Platform-aware identity key: case-insensitive on Windows, case-sensitive elsewhere. */
export function comparableSkillPath(value: string): string {
  const normalized = normalizeSkillPath(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function loadSkills(input: LoadSkillsInput): SkillLoadResult {
  const diagnostics: SkillDiagnostic[] = [];
  const allSkills: Skill[] = [];
  const scans: SkillRootScan[] = input.roots.map((root) => {
    throwIfAborted(input.signal);
    const scan = scanRoot(root, input.policy, input.signal);
    allSkills.push(...scan.skills);
    diagnostics.push(...scan.diagnostics);
    return scan;
  });
  return { skills: deduplicateAndResolveConflicts(allSkills, diagnostics), diagnostics, scans };
}

export function validateSkillsPolicy(policy: Readonly<SkillsPolicy>): string[] {
  const problems: string[] = [];
  const entries: Array<[keyof SkillsPolicy, string]> = [
    ['maxScanDepth', 'maxScanDepth'],
    ['maxScannedDirectoriesPerRoot', 'maxScannedDirectoriesPerRoot'],
    ['maxDiscoveredSkillsPerRoot', 'maxDiscoveredSkillsPerRoot'],
    ['maxManifestBytes', 'maxManifestBytes'],
    ['maxContentCharacters', 'maxContentCharacters'],
    ['maxCatalogItems', 'maxCatalogItems'],
    ['maxCatalogDescriptionCharacters', 'maxCatalogDescriptionCharacters'],
  ];
  for (const [key, label] of entries) {
    const value = policy[key];
    if (!Number.isInteger(value) || value <= 0) {
      problems.push(`${label} must be a positive integer, got ${String(value)}.`);
    }
  }
  if (policy.maxScannedDirectoriesPerRoot < policy.maxDiscoveredSkillsPerRoot) {
    problems.push('maxScannedDirectoriesPerRoot must be >= maxDiscoveredSkillsPerRoot.');
  }
  return problems;
}

function scanRoot(root: SkillRoot, policy: Readonly<SkillsPolicy>, signal?: AbortSignal): SkillRootScan {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync.native(path.resolve(root.rootPath));
  } catch (error) {
    // A Root that simply does not exist (e.g. .megumi/skills before the first
    // workspace use) is an empty Root, never an error. Only a Root whose
    // ancestor chain is broken (a parent exists as a file) is unavailable.
    if (isMissingPathError(error) && !hasBrokenDirectoryAncestor(root.rootPath)) {
      return { status: 'absent', skills: [], diagnostics: [] };
    }
    return {
      status: 'unavailable',
      skills: [],
      diagnostics: [{
        level: 'error',
        code: 'root_unreadable',
        message: `Skill Root is not accessible: ${root.rootPath}`,
      }],
    };
  }
  if (!fs.statSync(realRoot).isDirectory()) {
    return {
      status: 'unavailable',
      skills: [],
      diagnostics: [{
        level: 'error',
        code: 'root_unreadable',
        message: `Skill Root is not a directory: ${root.rootPath}`,
      }],
    };
  }

  const diagnostics: SkillDiagnostic[] = [];
  const discovered = discoverSkillPaths(realRoot, root, policy, diagnostics, signal);
  const skills: Skill[] = [];
  for (const skillPath of discovered) {
    throwIfAborted(signal);
    const skill = readSkillPackage(root, skillPath, policy, diagnostics, signal);
    if (skill) skills.push(skill);
  }
  return { status: 'ok', skills, diagnostics };
}

function discoverSkillPaths(
  realRoot: string,
  root: SkillRoot,
  policy: Readonly<SkillsPolicy>,
  diagnostics: SkillDiagnostic[],
  signal?: AbortSignal,
): string[] {
  const excluded = new Set((root.excludedDirectoryNames ?? []).map((name) => name.toLowerCase()));
  const ignoreRules = loadIgnoreRules(realRoot);
  const discovered: string[] = [];
  let scannedDirectories = 0;
  const stack: Array<{ directory: string; depth: number }> = [{ directory: realRoot, depth: 0 }];
  let scanStopped = false;

  while (stack.length > 0 && !scanStopped) {
    throwIfAborted(signal);
    const current = stack.pop();
    if (!current) continue;
    if (current.depth > policy.maxScanDepth) continue;
    if (scannedDirectories >= policy.maxScannedDirectoriesPerRoot) {
      diagnostics.push({
        level: 'warning',
        code: 'scan_limited',
        message: `Skill scan stopped: directory limit reached for ${root.rootPath}`,
      });
      scanStopped = true;
      break;
    }
    scannedDirectories += 1;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch {
      diagnostics.push({
        level: 'error',
        code: 'root_unreadable',
        message: `Skill directory is not readable: ${current.directory}`,
      });
      continue;
    }

    if (discovered.length >= policy.maxDiscoveredSkillsPerRoot) {
      diagnostics.push({
        level: 'warning',
        code: 'scan_limited',
        message: `Skill scan stopped: Skill count limit reached for ${root.rootPath}`,
      });
      break;
    }
    if (entries.some((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name === 'SKILL.md')) {
      const candidate = normalizeSkillPath(path.join(current.directory, 'SKILL.md'));
      if (isInsideRoot(realRoot, candidate)) discovered.push(candidate);
      continue;
    }

    const childDirectories: fs.Dirent[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const name = entry.name;
      if (isHidden(name) || name === 'node_modules') continue;
      if (excluded.has(name.toLowerCase())) continue;
      const childPath = path.join(current.directory, name);
      // The ignore package matches forward-slash relative paths; on Windows the
      // platform separators are converted so gitignore-style rules apply uniformly.
      if (ignoreRules.ignores(path.relative(realRoot, childPath).split(path.sep).join('/'))) continue;
      if (entry.isSymbolicLink()) {
        // Only follow directory symlinks that stay inside the Root; escapes are skipped.
        try {
          if (!fs.statSync(childPath).isDirectory()) continue;
          if (!isInsideRoot(realRoot, fs.realpathSync.native(childPath))) continue;
        } catch {
          continue;
        }
      }
      childDirectories.push(entry);
    }
    childDirectories.sort((left, right) => left.name.localeCompare(right.name));
    for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
      stack.push({ directory: path.join(current.directory, childDirectories[index]!.name), depth: current.depth + 1 });
    }
  }

  return discovered.sort();
}

function readSkillPackage(
  root: SkillRoot,
  skillPath: string,
  policy: Readonly<SkillsPolicy>,
  diagnostics: SkillDiagnostic[],
  signal?: AbortSignal,
): Skill | undefined {
  throwIfAborted(signal);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(skillPath);
  } catch {
    diagnostics.push({
      level: 'error',
      code: 'skill_unreadable',
      message: `Skill manifest cannot be read: ${skillPath}`,
    });
    return undefined;
  }
  if (stats.size > policy.maxManifestBytes) {
    diagnostics.push({
      level: 'error',
      code: 'skill_manifest_too_large',
      message: `Skill manifest exceeds ${policy.maxManifestBytes} bytes: ${skillPath}`,
    });
    return undefined;
  }
  throwIfAborted(signal);
  let text: string;
  try {
    text = fs.readFileSync(skillPath, 'utf8');
  } catch {
    diagnostics.push({
      level: 'error',
      code: 'skill_unreadable',
      message: `Skill manifest cannot be read: ${skillPath}`,
    });
    return undefined;
  }
  throwIfAborted(signal);

  const parsed = parseSkillManifest({ filePath: skillPath, text });
  diagnostics.push(...parsed.diagnostics);
  if (!parsed.manifest) return undefined;
  if (parsed.manifest.content.length > policy.maxContentCharacters) {
    diagnostics.push({
      level: 'error',
      code: 'skill_content_too_large',
      message: `Skill content exceeds ${policy.maxContentCharacters} characters: ${skillPath}`,
    });
    return undefined;
  }
  return {
    name: parsed.manifest.name,
    description: parsed.manifest.description,
    skillPath,
    packagePath: path.dirname(skillPath),
    source: {
      owner: root.owner,
      scope: root.scope,
      ...(root.workspaceId ? { workspaceId: root.workspaceId } : {}),
    },
    content: parsed.manifest.content,
    disableModelInvocation: parsed.manifest.disableModelInvocation,
    available: true,
    diagnostics: [...parsed.diagnostics],
  };
}

function deduplicateAndResolveConflicts(skills: readonly Skill[], diagnostics: SkillDiagnostic[]): Skill[] {
  const byPath = new Map<string, Skill>();
  const byName = new Map<string, Skill>();
  const output: Skill[] = [];
  for (const skill of skills) {
    const pathKey = comparableSkillPath(skill.skillPath);
    if (byPath.has(pathKey)) continue; // same real file discovered through another Root or symlink
    byPath.set(pathKey, skill);
    const existing = byName.get(skill.name);
    if (existing) {
      diagnostics.push({
        level: 'warning',
        code: 'name_conflict',
        message: `Skill name conflict: ${existing.name} keeps ${existing.skillPath}, skipping ${skill.skillPath}`,
      });
      continue;
    }
    byName.set(skill.name, skill);
    output.push(skill);
  }
  return output;
}

function loadIgnoreRules(realRoot: string): Ignore {
  const rules = ignore();
  for (const fileName of ['.gitignore', '.ignore', '.fdignore']) {
    try {
      const content = fs.readFileSync(path.join(realRoot, fileName), 'utf8');
      rules.add(content.split(/\r?\n/));
    } catch {
      // Missing or unreadable ignore files are normal; default exclusions still apply.
    }
  }
  return rules;
}

function isInsideRoot(realRoot: string, candidate: string): boolean {
  const relative = path.relative(realRoot, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isHidden(name: string): boolean {
  return name.startsWith('.');
}

function isMissingPathError(error: unknown): boolean {
  // ENOENT: the Root path itself does not exist. ENOTDIR and other errors mean
  // the path exists in a broken state and the Root is unavailable.
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function hasBrokenDirectoryAncestor(rootPath: string): boolean {
  // Walks up from the missing Root until it finds an existing ancestor. A
  // non-directory ancestor (e.g. .megumi/skills under a file) means the Root
  // exists in a broken state; an all-missing chain is a Root not created yet.
  let current = path.dirname(path.resolve(rootPath));
  while (true) {
    let stats: fs.Stats;
    try {
      stats = fs.statSync(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return false;
      current = parent;
      continue;
    }
    return !stats.isDirectory();
  }
}
