// Builds Coding Agent run context resources without depending on desktop filesystem or SQLite.
import path from 'node:path';
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type { ModelCapabilitySummary, RunContext, RunContextSource } from '@megumi/shared/run';

export interface RunContextServiceClock {
  now(): string;
}

export interface RunContextRepositoryPort {
  saveBaseline(context: RunContext): RunContext;
  getBaseline(contextId: string): RunContext | undefined;
  saveSourceRef(source: RunContextSource & { runId: string }): RunContextSource;
}

export interface WorkspaceSourceProviderPort {
  listWorkspaceSources(input: {
    runId: string;
    workspaceId: string;
    workspacePath: string;
    loadedAt: string;
  }): RunContextSource[];
}

export interface RunContextServiceOptions {
  contextRepository: RunContextRepositoryPort;
  workspaceSourceProvider?: WorkspaceSourceProviderPort;
  clock?: RunContextServiceClock;
}

export interface CreateBaselineContextInput {
  runId: string;
  goal: string;
  workspaceId: string;
  workspacePath: string;
  modelCapabilitySummary: ModelCapabilitySummary;
  contextBudgetPolicy: ContextBudgetPolicy;
}

export interface ListWorkspaceSourcesInput {
  runId: string;
  workspaceId: string;
  workspacePath: string;
}

const defaultClock: RunContextServiceClock = {
  now: () => new Date().toISOString(),
};

const DEFAULT_DENIED_GLOBS = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

// Product-facing run-context surface consumed by UI shells. Shells code against
// this port, not the concrete RunContextService.
export interface RunContextServicePort {
  getBaselineContext(runId: string): RunContext | undefined;
  listWorkspaceSourcesByRun(runId: string): RunContextSource[];
}

export class RunContextService implements RunContextServicePort {
  private readonly contextRepository: RunContextRepositoryPort;
  private readonly workspaceSourceProvider?: WorkspaceSourceProviderPort;
  private readonly clock: RunContextServiceClock;

  constructor(options: RunContextServiceOptions) {
    this.contextRepository = options.contextRepository;
    this.workspaceSourceProvider = options.workspaceSourceProvider;
    this.clock = options.clock ?? defaultClock;
  }

  createBaselineContext(input: CreateBaselineContextInput): RunContext {
    const now = this.clock.now();
    const context: RunContext = {
      contextId: `context:${input.runId}`,
      runId: input.runId,
      workspaceBoundary: {
        workspaceId: input.workspaceId,
        rootPath: input.workspacePath,
        displayName: path.basename(input.workspacePath),
        allowedRoots: [input.workspacePath],
        deniedGlobs: DEFAULT_DENIED_GLOBS,
        protectedPaths: ['.env', '.env.*'],
        ignoreSources: ['gitignore', 'megumi_policy'],
        symlinkPolicy: 'deny_outside_workspace',
        outsideWorkspacePolicy: 'deny',
        secretPolicySummary: 'Secret-like files are blocked or redacted before context materialization.',
        createdAt: now,
      },
      goal: input.goal,
      constraints: ['Do not read or persist secrets in clear text.'],
      inlineContents: [],
      resourceRefs: [],
      conversationRefs: [],
      messageSummaries: [],
      workspaceSources: [],
      toolObservationRefs: [],
      memoryRecallRefs: [],
      policySummary: {
        workspaceAccess: 'workspace-read',
        restrictedResources: ['.env', 'private keys', 'credential files', 'database files'],
        approvalSummary: 'Context acquisition grants no tool approval.',
        sandboxSummary: 'Context acquisition is read-only and Host-controlled.',
      },
      modelCapabilitySummary: input.modelCapabilitySummary,
      contextBudgetPolicy: input.contextBudgetPolicy,
      buildMetadata: {
        buildReason: 'run_baseline',
        builtAt: now,
        selectionRecordIds: [],
        redactionRecordIds: [],
        truncationRecordIds: [],
      },
      createdAt: now,
    };

    return this.contextRepository.saveBaseline(context);
  }

  getBaselineContext(runId: string): RunContext | undefined {
    return this.contextRepository.getBaseline(`context:${runId}`);
  }

  listWorkspaceSourcesByRun(runId: string): RunContextSource[] {
    const baseline = this.getBaselineContext(runId);
    if (!baseline) {
      return [];
    }

    return this.listWorkspaceSources({
      runId,
      workspaceId: String(baseline.workspaceBoundary.workspaceId),
      workspacePath: baseline.workspaceBoundary.rootPath,
    });
  }

  listWorkspaceSources(input: ListWorkspaceSourcesInput): RunContextSource[] {
    const loadedAt = this.clock.now();
    const sources = this.workspaceSourceProvider?.listWorkspaceSources({
      ...input,
      loadedAt,
    }) ?? [];

    for (const source of sources) {
      this.contextRepository.saveSourceRef({ ...source, runId: input.runId });
    }

    return sources;
  }
}
