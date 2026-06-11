import { readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { createDatabase } from '@megumi/db/connection';
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type {
  RunContext,
  RunContextSource,
  ModelCapabilitySummary,
} from '@megumi/shared/run';
import { RunContextRepository } from '@megumi/db/repos/run-context.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type { MegumiHomePaths } from '../project/megumi-home.service';

export interface RunContextServiceClock {
  now(): string;
}

export interface RunContextServiceOptions {
  contextRepository: RunContextRepository;
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
const BLOCKED_FILE_NAMES = new Set(['.env', '.env.local', '.env.production']);

export class RunContextService {
  private readonly contextRepository: RunContextRepository;
  private readonly clock: RunContextServiceClock;

  constructor(options: RunContextServiceOptions) {
    this.contextRepository = options.contextRepository;
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
    const root = path.resolve(input.workspacePath);
    const entries = readdirSync(root, { withFileTypes: true });
    const loadedAt = this.clock.now();
    const sources = entries
      .filter((entry) => entry.isFile())
      .map((entry): RunContextSource & { runId: string } => {
        const relativePath = entry.name;
        const fullPath = path.join(root, relativePath);
        const stat = statSync(fullPath);
        const blocked = BLOCKED_FILE_NAMES.has(entry.name) || entry.name.endsWith('.key');

        return {
          runId: input.runId,
          sourceId: `source:${input.runId}:${relativePath}`,
          sourceKind: 'workspace_file',
          sourceUri: `workspace://${input.workspaceId}/${relativePath}`,
          workspaceId: input.workspaceId,
          workspacePath: root,
          relativePath,
          mtime: stat.mtime.toISOString(),
          loadedAt,
          freshness: 'fresh',
          redactionState: blocked ? 'blocked' : 'none',
          selectionReason: blocked ? 'context_policy' : 'agent_requested',
          metadata: {
            runId: input.runId,
            sizeBytes: stat.size,
            contentLoaded: false,
          },
        };
      });

    for (const source of sources) {
      this.contextRepository.saveSourceRef(source);
    }

    return sources;
  }
}

export function createDefaultRunContextService(homePaths: MegumiHomePaths): RunContextService {
  const database = createDatabase(path.join(homePaths.sqlitePath, 'megumi.sqlite3'));
  migrateDatabase(database);

  return new RunContextService({
    contextRepository: new RunContextRepository(database),
  });
}


