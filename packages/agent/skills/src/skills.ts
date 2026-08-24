/*
 * Implements the long-lived Skills product module: one instance per product
 * lifecycle owns discoverable caches per scope, serialized refresh/delete/
 * availability mutations, availability persistence and immutable query results.
 *
 * Skills is created once by Product with Home Roots, a Workspace Root resolver and
 * the Database availability store. Queries always read one complete snapshot;
 * refresh swaps a scope atomically and never breaks the previous result.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseConnection } from '@megumi/database';
import type {
  Skill,
  SkillAvailability,
  SkillDiagnostic,
  SkillPackageOverview,
  SkillsFailure,
} from './skill';
import { SkillsCancelledError, throwIfAborted } from './skill';
import {
  comparableSkillPath,
  DEFAULT_SKILLS_POLICY,
  loadSkills,
  normalizeSkillPath,
  type SkillRoot,
  type SkillsPolicy,
  validateSkillsPolicy,
} from './skill-loader';
import {
  cleanupStaleAvailability,
  createDatabaseSkillAvailabilityStore,
  mergeSkillAvailability,
  type SkillAvailabilityStore,
} from './skill-availability';
import {
  buildSkillView,
  resolveSelectedSkill,
  type CreateSkillViewRequest,
  type CreateSkillViewResult,
  type ResolveSkillSelectionRequest,
  type ResolveSkillSelectionResult,
  type SkillView,
} from './skill-view';

export interface SkillRootResolver {
  resolveWorkspaceRoot(request: {
    workspaceId: string;
    signal?: AbortSignal;
  }): Promise<string | undefined>;
}

export interface CreateSkillsOptions {
  readonly homePath: string;
  readonly database: DatabaseConnection;
  readonly workspaceRootResolver?: SkillRootResolver;
  readonly policy?: Partial<SkillsPolicy>;
  readonly clock?: { now(): string };
}

export class SkillsPolicyConfigurationError extends Error {
  constructor(problems: readonly string[]) {
    super(`Skills Policy is invalid: ${problems.join(' ')}`);
    this.name = 'SkillsPolicyConfigurationError';
  }
}

export interface RefreshSkillsRequest {
  readonly workspaceId?: string;
  readonly signal?: AbortSignal;
}

export type RefreshSkillsResult =
  | { readonly status: 'ok'; readonly diagnostics: readonly SkillDiagnostic[] }
  | { readonly status: 'failed'; readonly failure: SkillsFailure };

export interface ListSkillsRequest {
  readonly workspaceId?: string;
  readonly signal?: AbortSignal;
}

export type ListSkillsResult =
  | {
      readonly status: 'ok';
      readonly skills: readonly Skill[];
      readonly diagnostics: readonly SkillDiagnostic[];
    }
  | { readonly status: 'failed'; readonly failure: SkillsFailure };

export interface GetSkillRequest {
  readonly skillPath: string;
  readonly workspaceId?: string;
  readonly signal?: AbortSignal;
}

export type GetSkillResult =
  | { readonly status: 'ok'; readonly skill: Skill }
  | { readonly status: 'failed'; readonly failure: SkillsFailure };

export interface EnableSkillRequest {
  readonly skillPath: string;
  readonly workspaceId?: string;
  readonly signal?: AbortSignal;
}

export interface DisableSkillRequest {
  readonly skillPath: string;
  readonly workspaceId?: string;
  readonly signal?: AbortSignal;
}

export type ChangeSkillAvailabilityResult =
  | { readonly status: 'ok'; readonly availability: SkillAvailability }
  | { readonly status: 'failed'; readonly failure: SkillsFailure };

export interface DeleteSkillRequest {
  readonly skillPath: string;
  readonly workspaceId?: string;
  readonly signal?: AbortSignal;
}

export type DeleteSkillResult =
  | { readonly status: 'ok'; readonly skillPath: string }
  | { readonly status: 'failed'; readonly failure: SkillsFailure };

export interface Skills {
  refresh(request: RefreshSkillsRequest): Promise<RefreshSkillsResult>;
  list(request: ListSkillsRequest): Promise<ListSkillsResult>;
  get(request: GetSkillRequest): Promise<GetSkillResult>;
  enable(request: EnableSkillRequest): Promise<ChangeSkillAvailabilityResult>;
  disable(request: DisableSkillRequest): Promise<ChangeSkillAvailabilityResult>;
  delete(request: DeleteSkillRequest): Promise<DeleteSkillResult>;
  resolveSelection(request: ResolveSkillSelectionRequest): Promise<ResolveSkillSelectionResult>;
  createView(request: CreateSkillViewRequest): Promise<CreateSkillViewResult>;
}

const SYSTEM_GLOBAL_SCOPE = 'system-global';

interface ScopeSnapshot {
  readonly skills: readonly Skill[];
  readonly diagnostics: readonly SkillDiagnostic[];
  readonly unavailable: boolean;
}

interface MergedSnapshot {
  readonly skills: readonly Skill[];
  readonly diagnostics: readonly SkillDiagnostic[];
  readonly unavailable: boolean;
}

export function createSkills(options: CreateSkillsOptions): Skills {
  const policy: SkillsPolicy = { ...DEFAULT_SKILLS_POLICY, ...options.policy };
  const problems = validateSkillsPolicy(policy);
  if (problems.length > 0) {
    throw new SkillsPolicyConfigurationError(problems);
  }
  return new SkillsImpl({
    ...options,
    policy,
    availabilityStore: createDatabaseSkillAvailabilityStore(options.database),
  });
}

/** Builds the management-view package overview without introducing a run Contract. */
export function buildSkillPackageOverview(skill: Skill): SkillPackageOverview {
  return {
    name: skill.name,
    description: skill.description,
    skillPath: skill.skillPath,
    packagePath: skill.packagePath,
    source: { ...skill.source },
    available: skill.available,
    disableModelInvocation: skill.disableModelInvocation,
    hasReferences: directoryExists(path.join(skill.packagePath, 'references')),
    hasAssets: directoryExists(path.join(skill.packagePath, 'assets')),
    hasScripts: directoryExists(path.join(skill.packagePath, 'scripts')),
  };
}

class SkillsImpl implements Skills {
  private readonly policy: SkillsPolicy;
  private readonly availabilityStore: SkillAvailabilityStore;
  private readonly workspaceRootResolver: SkillRootResolver | undefined;
  private readonly clock: { now(): string };
  private readonly systemGlobalRoots: readonly SkillRoot[];
  private readonly scopes = new Map<string, ScopeSnapshot>();
  private availabilityRecords: readonly SkillAvailability[] | undefined;
  private initTask: Promise<void> | undefined;
  private readonly mutations = new SerialQueue();

  constructor(options: CreateSkillsOptions & { policy: SkillsPolicy; availabilityStore: SkillAvailabilityStore }) {
    this.policy = options.policy;
    this.availabilityStore = options.availabilityStore;
    this.workspaceRootResolver = options.workspaceRootResolver;
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.systemGlobalRoots = systemGlobalRoots(options.homePath);
  }

  refresh(request: RefreshSkillsRequest): Promise<RefreshSkillsResult> {
    return this.mutations.run(async () => {
      try {
        throwIfAborted(request.signal);
        await this.ensureInitialized();
        const globalResult = await this.refreshScope(SYSTEM_GLOBAL_SCOPE, this.systemGlobalRoots, request.signal);
        if (request.workspaceId && globalResult.status === 'ok') {
          await this.refreshWorkspaceScope(request.workspaceId, request.signal);
        }
        return globalResult;
      } catch (error) {
        return { status: 'failed', failure: failureFromError(error) };
      }
    });
  }

  async list(request: ListSkillsRequest): Promise<ListSkillsResult> {
    try {
      const merged = await this.mergedSnapshot(request.workspaceId, request.signal);
      if (merged.unavailable) {
        return { status: 'failed', failure: skillsUnavailableFailure() };
      }
      throwIfAborted(request.signal);
      return {
        status: 'ok',
        skills: merged.skills.map(cloneSkill),
        diagnostics: [...merged.diagnostics],
      };
    } catch (error) {
      return { status: 'failed', failure: failureFromError(error) };
    }
  }

  async get(request: GetSkillRequest): Promise<GetSkillResult> {
    try {
      const merged = await this.mergedSnapshot(request.workspaceId, request.signal);
      if (merged.unavailable) {
        return { status: 'failed', failure: skillsUnavailableFailure() };
      }
      const skill = findSkillByPath(merged.skills, request.skillPath);
      return skill
        ? { status: 'ok', skill: cloneSkill(skill) }
        : { status: 'failed', failure: { code: 'skill_not_found', skillPath: request.skillPath } };
    } catch (error) {
      return { status: 'failed', failure: failureFromError(error) };
    }
  }

  enable(request: EnableSkillRequest): Promise<ChangeSkillAvailabilityResult> {
    return this.changeAvailability(request, true);
  }

  disable(request: DisableSkillRequest): Promise<ChangeSkillAvailabilityResult> {
    return this.changeAvailability(request, false);
  }

  async delete(request: DeleteSkillRequest): Promise<DeleteSkillResult> {
    return this.mutations.run(async () => {
      try {
        throwIfAborted(request.signal);
        await this.ensureInitialized();
        const merged = await this.mergedSnapshot(request.workspaceId, request.signal);
        if (merged.unavailable) {
          return { status: 'failed', failure: skillsUnavailableFailure() };
        }
        const skill = findSkillByPath(merged.skills, request.skillPath);
        if (!skill) {
          return { status: 'failed', failure: { code: 'skill_not_found', skillPath: request.skillPath } };
        }
        if (skill.source.owner !== 'user') {
          return { status: 'failed', failure: { code: 'delete_not_allowed', skillPath: skill.skillPath, reason: 'system_skill' } };
        }
        const userRoot = await this.userRootFor(skill, request.signal);
        if (!userRoot) {
          return { status: 'failed', failure: { code: 'delete_not_allowed', skillPath: skill.skillPath, reason: 'skill_root' } };
        }
        // Re-resolve the real path right before deletion so a swapped symlink cannot escape the Root.
        let realSkillPath: string;
        try {
          realSkillPath = fs.realpathSync.native(skill.skillPath);
        } catch {
          return { status: 'failed', failure: { code: 'skill_not_found', skillPath: skill.skillPath } };
        }
        const packageDirectory = path.dirname(realSkillPath);
        if (!isInsideRoot(userRoot, packageDirectory)) {
          return { status: 'failed', failure: { code: 'delete_not_allowed', skillPath: skill.skillPath, reason: 'skill_root' } };
        }
        if (comparableSkillPath(packageDirectory) === comparableSkillPath(userRoot)) {
          return { status: 'failed', failure: { code: 'delete_not_allowed', skillPath: skill.skillPath, reason: 'skill_root' } };
        }
        throwIfAborted(request.signal);
        try {
          fs.rmSync(packageDirectory, { recursive: true, force: false });
        } catch (error) {
          return { status: 'failed', failure: { code: 'internal', message: messageFromError(error, 'Failed to delete Skill package.') } };
        }
        // The file is gone: complete snapshot exclusion and availability convergence even if cancelled now.
        this.dropAvailabilityRecord(skill.skillPath);
        this.availabilityStore.delete(skill.skillPath);
        for (const [key, snapshot] of this.scopes) {
          this.scopes.set(key, {
            ...snapshot,
            skills: snapshot.skills.filter((candidate) => comparableSkillPath(candidate.skillPath) !== comparableSkillPath(skill.skillPath)),
          });
        }
        const affectedScope = skill.source.scope === 'workspace' && skill.source.workspaceId
          ? `workspace:${skill.source.workspaceId}`
          : SYSTEM_GLOBAL_SCOPE;
        await this.refreshScopeAfterDelete(affectedScope, request.signal);
        return { status: 'ok', skillPath: skill.skillPath };
      } catch (error) {
        return { status: 'failed', failure: failureFromError(error) };
      }
    });
  }

  async resolveSelection(request: ResolveSkillSelectionRequest): Promise<ResolveSkillSelectionResult> {
    try {
      const merged = await this.mergedSnapshot(request.workspaceId, request.signal);
      if (merged.unavailable) {
        return { status: 'failed', failure: skillsUnavailableFailure() };
      }
      const resolved = resolveSelectedSkill({ skills: merged.skills, skillSelection: request.skillSelection });
      if (resolved.status === 'failed') {
        return { status: 'failed', failure: resolved.failure };
      }
      throwIfAborted(request.signal);
      return {
        status: 'ok',
        content: {
          name: resolved.skill.name,
          skillPath: resolved.skill.skillPath,
          packagePath: resolved.skill.packagePath,
          content: resolved.skill.content,
        },
      };
    } catch (error) {
      return { status: 'failed', failure: failureFromError(error) };
    }
  }

  async createView(request: CreateSkillViewRequest): Promise<CreateSkillViewResult> {
    try {
      const merged = await this.mergedSnapshot(request.workspaceId, request.signal);
      if (merged.unavailable) {
        return { status: 'failed', failure: skillsUnavailableFailure() };
      }
      throwIfAborted(request.signal);
      return buildSkillView({
        skills: merged.skills,
        diagnostics: merged.diagnostics,
        policy: this.policy,
      });
    } catch (error) {
      return { status: 'failed', failure: failureFromError(error) };
    }
  }

  private changeAvailability(
    request: EnableSkillRequest | DisableSkillRequest,
    available: boolean,
  ): Promise<ChangeSkillAvailabilityResult> {
    return this.mutations.run(async () => {
      try {
        throwIfAborted(request.signal);
        await this.ensureInitialized();
        const merged = await this.mergedSnapshot(request.workspaceId, request.signal);
        if (merged.unavailable) {
          return { status: 'failed', failure: skillsUnavailableFailure() };
        }
        const skill = findSkillByPath(merged.skills, request.skillPath);
        if (!skill) {
          return { status: 'failed', failure: { code: 'skill_not_found', skillPath: request.skillPath } };
        }
        const availability: SkillAvailability = {
          skillPath: skill.skillPath,
          available,
          updatedAt: this.clock.now(),
        };
        this.availabilityStore.save(availability);
        this.upsertAvailabilityRecord(availability);
        return { status: 'ok', availability: { ...availability } };
      } catch (error) {
        return { status: 'failed', failure: failureFromError(error) };
      }
    });
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initTask) {
      this.initTask = this.mutations.run(async () => {
        await this.refreshScope(SYSTEM_GLOBAL_SCOPE, this.systemGlobalRoots, undefined);
      }).then(() => undefined, () => undefined);
    }
    return this.initTask;
  }

  private async refreshWorkspaceScope(workspaceId: string, signal?: AbortSignal): Promise<void> {
    const roots = await this.workspaceRoots(workspaceId, signal);
    throwIfAborted(signal);
    await this.refreshScope(`workspace:${workspaceId}`, roots, signal);
  }

  private async workspaceRoots(workspaceId: string, signal?: AbortSignal): Promise<SkillRoot[]> {
    if (!this.workspaceRootResolver) return [];
    const rootPath = await this.workspaceRootResolver.resolveWorkspaceRoot({ workspaceId, signal });
    return rootPath
      ? [{ owner: 'user' as const, scope: 'workspace' as const, workspaceId, rootPath }]
      : [];
  }

  private async refreshScope(
    key: string,
    roots: readonly SkillRoot[],
    signal?: AbortSignal,
  ): Promise<RefreshSkillsResult> {
    let result: ReturnType<typeof loadSkills>;
    try {
      result = loadSkills({ roots, policy: this.policy, signal });
    } catch (error) {
      if (error instanceof SkillsCancelledError) {
        return { status: 'failed', failure: { code: 'cancelled' } };
      }
      const previous = this.scopes.get(key);
      const snapshot: ScopeSnapshot = previous ?? { skills: [], diagnostics: [], unavailable: true };
      this.scopes.set(key, {
        ...snapshot,
        diagnostics: [...snapshot.diagnostics, {
          level: 'error',
          code: 'refresh_failed',
          message: messageFromError(error, 'Skill refresh failed.'),
        }],
      });
      return { status: 'failed', failure: { code: 'internal', message: messageFromError(error, 'Skill refresh failed.') } };
    }
    throwIfAborted(signal);
    const stale = cleanupStaleAvailability({ roots, records: this.records(), signal });
    throwIfAborted(signal);
    for (const record of stale) {
      this.availabilityStore.delete(record.skillPath);
      this.dropAvailabilityRecord(record.skillPath);
    }
    const unavailable = result.scans.length > 0 && result.scans.every((scan) => scan.status === 'unavailable');
    this.scopes.set(key, { skills: result.skills, diagnostics: result.diagnostics, unavailable });
    return { status: 'ok', diagnostics: result.diagnostics };
  }

  private async refreshScopeAfterDelete(key: string, signal?: AbortSignal): Promise<void> {
    try {
      const roots = key === SYSTEM_GLOBAL_SCOPE
        ? this.systemGlobalRoots
        : await this.workspaceRoots(key.slice('workspace:'.length), signal);
      await this.refreshScope(key, roots, signal);
    } catch {
      // Refresh failure keeps the surgically removed snapshot; the deleted Skill stays hidden.
    }
  }

  private async mergedSnapshot(workspaceId?: string, signal?: AbortSignal): Promise<MergedSnapshot> {
    throwIfAborted(signal);
    const global = await this.ensureScope(SYSTEM_GLOBAL_SCOPE, this.systemGlobalRoots, signal);
    throwIfAborted(signal);
    if (!workspaceId) {
      return {
        skills: mergeSkillAvailability(global.skills, this.records()),
        diagnostics: [...global.diagnostics],
        unavailable: global.unavailable,
      };
    }
    const workspace = await this.ensureScope(`workspace:${workspaceId}`, undefined, signal, workspaceId);
    throwIfAborted(signal);
    const globalPaths = new Set(global.skills.map((skill) => comparableSkillPath(skill.skillPath)));
    const globalNames = new Set(global.skills.map((skill) => skill.name));
    const diagnostics = [...global.diagnostics, ...workspace.diagnostics];
    const workspaceSkills: Skill[] = [];
    for (const skill of workspace.skills) {
      if (globalPaths.has(comparableSkillPath(skill.skillPath))) continue; // same real file already seen
      if (globalNames.has(skill.name)) {
        diagnostics.push({
          level: 'warning',
          code: 'name_conflict',
          message: `Skill name conflict: ${skill.name} keeps the higher-priority Skill, skipping ${skill.skillPath}`,
        });
        continue;
      }
      workspaceSkills.push(skill);
    }
    return {
      skills: mergeSkillAvailability([...global.skills, ...workspaceSkills], this.records()),
      diagnostics,
      unavailable: global.unavailable && workspace.unavailable,
    };
  }

  private async ensureScope(
    key: string,
    roots?: readonly SkillRoot[],
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<ScopeSnapshot> {
    await this.ensureInitialized();
    let snapshot = this.scopes.get(key);
    if (!snapshot) {
      const scopeRoots = roots ?? (workspaceId ? await this.workspaceRoots(workspaceId, signal) : []);
      await this.mutations.run(() => this.refreshScope(key, scopeRoots, signal));
      snapshot = this.scopes.get(key);
    }
    return snapshot!;
  }

  private async userRootFor(skill: Skill, signal?: AbortSignal): Promise<string | undefined> {
    const realSkillPath = normalizeSkillPath(skill.skillPath);
    if (skill.source.scope === 'workspace' && skill.source.workspaceId) {
      const workspaceRoots = await this.workspaceRoots(skill.source.workspaceId, signal);
      const root = workspaceRoots.find((candidate) => isInsideRoot(normalizeSkillPath(candidate.rootPath), realSkillPath));
      return root ? normalizeSkillPath(root.rootPath) : undefined;
    }
    const globalUserRoot = this.systemGlobalRoots.find((candidate) => candidate.owner === 'user' && candidate.scope === 'global');
    if (!globalUserRoot) return undefined;
    const realRoot = normalizeSkillPath(globalUserRoot.rootPath);
    return isInsideRoot(realRoot, realSkillPath) ? realRoot : undefined;
  }

  private records(): readonly SkillAvailability[] {
    if (!this.availabilityRecords) {
      this.availabilityRecords = this.availabilityStore.list();
    }
    return this.availabilityRecords;
  }

  private upsertAvailabilityRecord(record: SkillAvailability): void {
    this.availabilityRecords = [
      ...this.records().filter((candidate) => comparableSkillPath(candidate.skillPath) !== comparableSkillPath(record.skillPath)),
      record,
    ];
  }

  private dropAvailabilityRecord(skillPath: string): void {
    const key = comparableSkillPath(skillPath);
    this.availabilityRecords = this.records().filter((candidate) => comparableSkillPath(candidate.skillPath) !== key);
  }
}

class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private running = false;

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running) {
      return task(); // reentrant call from inside a queued mutation
    }
    const result = this.tail.then(async () => {
      this.running = true;
      try {
        return await task();
      } finally {
        this.running = false;
      }
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function systemGlobalRoots(homePath: string): SkillRoot[] {
  return [
    { owner: 'system', scope: 'global', rootPath: path.join(homePath, 'skills', '.system') },
    {
      owner: 'user',
      scope: 'global',
      rootPath: path.join(homePath, 'skills'),
      excludedDirectoryNames: ['.system'],
    },
  ];
}

function findSkillByPath(skills: readonly Skill[], skillPath: string): Skill | undefined {
  const key = comparableSkillPath(skillPath);
  return skills.find((skill) => comparableSkillPath(skill.skillPath) === key);
}

function cloneSkill(skill: Skill): Skill {
  return {
    ...skill,
    source: { ...skill.source },
    diagnostics: [...skill.diagnostics],
  };
}

function skillsUnavailableFailure(): SkillsFailure {
  return {
    code: 'skills_unavailable',
    message: 'Skill discovery could not be established because no Skill Root is accessible.',
  };
}

function failureFromError(error: unknown): SkillsFailure {
  if (error instanceof SkillsCancelledError) {
    return { code: 'cancelled' };
  }
  return { code: 'internal', message: messageFromError(error, 'Skills operation failed.') };
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isInsideRoot(realRoot: string, candidate: string): boolean {
  const relative = path.relative(realRoot, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function directoryExists(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}
