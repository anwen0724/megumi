/*
 * Manages discovered Skills, persisted availability, selections and the model-facing catalog.
 */
import {
  comparableSkillPath,
  DEFAULT_SKILLS_POLICY,
  loadSkills,
  normalizeSkillPath,
  validateSkillsPolicy,
  type Skill as LoadedSkill,
  type SkillDiagnostic,
  type SkillRoot,
  type SkillsPolicy,
} from '@megumi/agent';
import fs from 'node:fs';
import path from 'node:path';

export interface Skill extends LoadedSkill {
  readonly available: boolean;
}

export interface SkillSelection {
  readonly type: 'skill';
  readonly name: string;
  readonly skillPath: string;
}

export interface SelectedSkillContent {
  readonly name: string;
  readonly skillPath: string;
  readonly packagePath: string;
  readonly content: string;
}

/** A persisted Skill availability row with independent storage identity. */
export interface SkillAvailability {
  readonly skillAvailabilityId: string;
  readonly skillPath: string;
  readonly available: boolean;
  readonly updatedAt: string;
}

export type SkillsFailure =
  | { readonly code: 'skills_unavailable'; readonly message: string }
  | { readonly code: 'skill_not_found'; readonly skillPath: string }
  | { readonly code: 'skill_unavailable'; readonly skillPath: string }
  | { readonly code: 'skill_invalid'; readonly skillPath: string; readonly diagnostics: readonly SkillDiagnostic[] }
  | { readonly code: 'skill_selection_changed'; readonly skillPath: string; readonly name: string }
  | { readonly code: 'delete_not_allowed'; readonly skillPath: string; readonly reason: 'system_skill' | 'skill_root' }
  | { readonly code: 'cancelled' }
  | { readonly code: 'internal'; readonly message: string };

/** Describes a Skill failure for callers without exposing discovery internals. */
export function skillsFailureMessage(failure: SkillsFailure): string {
  switch (failure.code) {
    case 'skills_unavailable':
      return failure.message;
    case 'skill_not_found':
      return `Skill was not found: ${failure.skillPath}`;
    case 'skill_unavailable':
      return `Skill is unavailable: ${failure.skillPath}`;
    case 'skill_invalid':
      return `Skill is invalid: ${failure.skillPath}`;
    case 'skill_selection_changed':
      return `Skill selection is stale: ${failure.skillPath} is now named ${failure.name}.`;
    case 'delete_not_allowed':
      return failure.reason === 'system_skill'
        ? 'System Skills cannot be deleted.'
        : 'The Skill Root itself cannot be deleted.';
    case 'cancelled':
      return 'Skills operation was cancelled.';
    case 'internal':
      return failure.message;
  }
}

class SkillsCancelledError extends Error {
  constructor() {
    super('Skills operation was cancelled.');
    this.name = 'SkillsCancelledError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SkillsCancelledError();
  }
}

export interface SkillRootResolver {
  resolveWorkspaceRoot(request: {
    workspaceId: string;
    signal?: AbortSignal;
  }): Promise<string | undefined>;
}

export interface CreateSkillsOptions {
  readonly homePath: string;
  readonly availabilityStore: SkillAvailabilityStore;
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
  /** Reloads discovered packages in the selected workspace scope. */
  refresh(request: RefreshSkillsRequest): Promise<RefreshSkillsResult>;
  /** Lists discovered packages with their persisted availability. */
  list(request: ListSkillsRequest): Promise<ListSkillsResult>;
  /** Reads one discovered package within the selected scope. */
  get(request: GetSkillRequest): Promise<GetSkillResult>;
  /** Persists availability for a discovered package. */
  enable(request: EnableSkillRequest): Promise<ChangeSkillAvailabilityResult>;
  /** Persists unavailability for a discovered package. */
  disable(request: DisableSkillRequest): Promise<ChangeSkillAvailabilityResult>;
  /** Removes an eligible user package and its availability record. */
  delete(request: DeleteSkillRequest): Promise<DeleteSkillResult>;
  /** Resolves a user selection, rejecting missing, unavailable or renamed packages. */
  resolveSelection(request: ResolveSkillSelectionRequest): Promise<ResolveSkillSelectionResult>;
  /** Builds the model-facing catalog for this workspace. */
  createView(request: CreateSkillViewRequest): Promise<CreateSkillViewResult>;
}

const SYSTEM_GLOBAL_SCOPE = 'system-global';

interface ScopeSnapshot {
  readonly skills: readonly LoadedSkill[];
  readonly diagnostics: readonly SkillDiagnostic[];
  readonly unavailable: boolean;
}

interface MergedSnapshot {
  readonly skills: readonly Skill[];
  readonly diagnostics: readonly SkillDiagnostic[];
  readonly unavailable: boolean;
}

/** Creates discovery and availability management shared by all workspace Skill views. */
export function createSkills(options: CreateSkillsOptions): Skills {
  const policy: SkillsPolicy = { ...DEFAULT_SKILLS_POLICY, ...options.policy };
  const problems = validateSkillsPolicy(policy);
  if (problems.length > 0) {
    throw new SkillsPolicyConfigurationError(problems);
  }
  return new SkillsImpl({
    ...options,
    policy,
  });
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
        const availabilityRecord = this.records().find(
          (record) => comparableSkillPath(record.skillPath) === comparableSkillPath(skill.skillPath),
        );
        if (availabilityRecord) {
          this.availabilityStore.deleteSkillAvailabilityById(
            availabilityRecord.skillAvailabilityId,
          );
        }
        this.dropAvailabilityRecord(skill.skillPath);
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
        const availability = this.availabilityStore.upsertSkillAvailability({
          skillPath: skill.skillPath,
          available,
          updatedAt: this.clock.now(),
        });
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
      if (signal?.aborted) {
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
      this.availabilityStore.deleteSkillAvailabilityById(
        record.skillAvailabilityId,
      );
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
    const workspaceSkills: LoadedSkill[] = [];
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
      this.availabilityRecords = this.availabilityStore.listAllSkillAvailability();
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

export interface SkillAvailabilityStore {
  /** Finds one persisted availability row by its database identity. */
  findSkillAvailabilityById(
    skillAvailabilityId: string,
  ): SkillAvailability | undefined;
  /** Lists every persisted availability row in stable Skill-path order. */
  listAllSkillAvailability(): readonly SkillAvailability[];
  /** Creates or updates the row selected by the unique Skill path. */
  upsertSkillAvailability(input: {
    readonly skillPath: string;
    readonly available: boolean;
    readonly updatedAt: string;
  }): SkillAvailability;
  /** Deletes one persisted availability row by its database identity. */
  deleteSkillAvailabilityById(skillAvailabilityId: string): boolean;
}

/** Combines discovery facts with persisted user availability. */
function mergeSkillAvailability(
  skills: readonly LoadedSkill[],
  records: readonly SkillAvailability[],
): readonly Skill[] {
  const byPath = new Map(records.map((record) => [comparableSkillPath(record.skillPath), record.available]));
  return skills.map((skill) => {
    const available = byPath.get(comparableSkillPath(skill.skillPath)) ?? true;
    return { ...skill, available };
  });
}

/** Identifies availability records whose package no longer exists under the known roots. */
function cleanupStaleAvailability(input: {
  roots: readonly SkillRoot[];
  records: readonly SkillAvailability[];
  signal?: AbortSignal;
}): readonly SkillAvailability[] {
  const realRoots: Array<{ root: SkillRoot; realPath: string }> = [];
  for (const root of input.roots) {
    try {
      realRoots.push({ root, realPath: fs.realpathSync.native(path.resolve(root.rootPath)) });
    } catch {
      // Root unavailable: keep records untouched.
    }
  }
  const stale: SkillAvailability[] = [];
  for (const record of input.records) {
    throwIfAborted(input.signal);
    const root = realRoots.find((candidate) => isInsideAvailabilityRoot(candidate.realPath, record.skillPath));
    if (!root) continue;
    try {
      if (!fs.statSync(record.skillPath).isFile()) stale.push(record);
    } catch {
      stale.push(record);
    }
  }
  return stale;
}

function isInsideAvailabilityRoot(realRoot: string, candidate: string): boolean {
  const relative = path.relative(realRoot, normalizeSkillPath(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export interface SkillCatalogItem {
  readonly name: string;
  readonly description: string;
  readonly skillPath: string;
}

export interface SkillView {
  readonly catalog: readonly SkillCatalogItem[];
  readonly diagnostics: readonly SkillDiagnostic[];
}

export interface ResolveSkillSelectionRequest {
  readonly skillSelection: SkillSelection;
  readonly workspaceId?: string;
  readonly signal?: AbortSignal;
}

export type ResolveSkillSelectionResult =
  | { readonly status: 'ok'; readonly content: SelectedSkillContent }
  | { readonly status: 'failed'; readonly failure: SkillsFailure };

export interface CreateSkillViewRequest {
  readonly workspaceId?: string;
  readonly signal?: AbortSignal;
}

export type CreateSkillViewResult =
  | { readonly status: 'ok'; readonly view: SkillView }
  | { readonly status: 'failed'; readonly failure: SkillsFailure };

/** Validates that the selected package remains available under the selected name. */
function resolveSelectedSkill(input: {
  skills: readonly Skill[];
  skillSelection: SkillSelection;
}): { status: 'ok'; skill: Skill } | { status: 'failed'; failure: SkillsFailure } {
  const targetKey = comparableSkillPath(input.skillSelection.skillPath);
  const skill = input.skills.find((candidate) => comparableSkillPath(candidate.skillPath) === targetKey);
  if (!skill) {
    return {
      status: 'failed',
      failure: { code: 'skill_not_found', skillPath: input.skillSelection.skillPath },
    };
  }
  if (!skill.available) {
    return {
      status: 'failed',
      failure: { code: 'skill_unavailable', skillPath: skill.skillPath },
    };
  }
  if (skill.name !== input.skillSelection.name) {
    return {
      status: 'failed',
      failure: { code: 'skill_selection_changed', skillPath: skill.skillPath, name: skill.name },
    };
  }
  return { status: 'ok', skill };
}

/** Projects only available and model-invocable packages into context. */
function buildSkillView(input: {
  skills: readonly Skill[];
  diagnostics: readonly SkillDiagnostic[];
  policy: Readonly<SkillsPolicy>;
}): { status: 'ok'; view: SkillView } {
  const diagnostics: SkillDiagnostic[] = [...input.diagnostics];
  const eligible = input.skills
    .filter((skill) => skill.available && !skill.disableModelInvocation)
    .sort((left, right) => left.name.localeCompare(right.name) || left.skillPath.localeCompare(right.skillPath));

  const catalog: SkillCatalogItem[] = [];
  for (const skill of eligible) {
    if (skill.description.length > input.policy.maxCatalogDescriptionCharacters) {
      diagnostics.push({
        level: 'warning',
        code: 'catalog_limited',
        message: `Skill description exceeds ${input.policy.maxCatalogDescriptionCharacters} characters and is omitted from the catalog: ${skill.skillPath}`,
      });
      continue;
    }
    if (catalog.length >= input.policy.maxCatalogItems) {
      diagnostics.push({
        level: 'warning',
        code: 'catalog_limited',
        message: `Skill catalog is limited to ${input.policy.maxCatalogItems} items; further Skills are omitted.`,
      });
      break;
    }
    catalog.push({ name: skill.name, description: skill.description, skillPath: skill.skillPath });
  }

  return {
    status: 'ok',
    view: {
      catalog,
      diagnostics,
    },
  };
}
