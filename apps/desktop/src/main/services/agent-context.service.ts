import { readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import type {
  AgentContext,
  ContextSourceRef,
  ModelCapabilitySummary,
} from '@megumi/shared/agent-context-contracts';
import type { AgentContextRepository } from '@megumi/db/repos/agent-context.repo';

export interface AgentContextServiceClock {
  now(): string;
}

export interface AgentContextServiceOptions {
  contextRepository: AgentContextRepository;
  clock?: AgentContextServiceClock;
}

export interface CreateBaselineContextInput {
  runId: string;
  goal: string;
  workspaceId: string;
  workspacePath: string;
  modelCapabilitySummary: ModelCapabilitySummary;
}

export interface ListWorkspaceSourcesInput {
  runId: string;
  workspaceId: string;
  workspacePath: string;
}

const defaultClock: AgentContextServiceClock = {
  now: () => new Date().toISOString(),
};

const DEFAULT_DENIED_GLOBS = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];
const BLOCKED_FILE_NAMES = new Set(['.env', '.env.local', '.env.production']);

export class AgentContextService {
  private readonly contextRepository: AgentContextRepository;
  private readonly clock: AgentContextServiceClock;

  constructor(options: AgentContextServiceOptions) {
    this.contextRepository = options.contextRepository;
    this.clock = options.clock ?? defaultClock;
  }

  createBaselineContext(input: CreateBaselineContextInput): AgentContext {
    const now = this.clock.now();
    const context: AgentContext = {
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
      budget: {
        modelContextWindow: input.modelCapabilitySummary.modelContextWindow,
        reservedOutputTokens: input.modelCapabilitySummary.reservedOutputTokens,
        availableInputTokens: input.modelCapabilitySummary.availableInputTokens,
        budgetPolicy: 'balanced',
        packingStrategy: 'priority_then_recent',
        truncationRecords: [],
      },
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

  getBaselineContext(runId: string): AgentContext | undefined {
    return this.contextRepository.getBaseline(`context:${runId}`);
  }

  listWorkspaceSourcesByRun(runId: string): ContextSourceRef[] {
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

  listWorkspaceSources(input: ListWorkspaceSourcesInput): ContextSourceRef[] {
    const root = path.resolve(input.workspacePath);
    const entries = readdirSync(root, { withFileTypes: true });
    const loadedAt = this.clock.now();
    const sources = entries
      .filter((entry) => entry.isFile())
      .map((entry): ContextSourceRef & { runId: string } => {
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
