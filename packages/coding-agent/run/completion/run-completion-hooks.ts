// Owns post-terminal run hooks such as memory capture and workspace footer projection.
// These hooks are product behavior, but they must not thicken AgentRunService.
import { isProviderId } from '@megumi/shared/provider';
import type { ProviderId } from '@megumi/shared/provider';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { MemoryCaptureSignal } from '@megumi/shared/memory';
import type { WorkspaceChangedFile } from '@megumi/shared/workspace';
import type { ChatStreamEventAdapter } from '../../projections/chat-stream';
import type { WorkspaceChangeFooterProjectorService } from '../../workspace';

export interface RunCompletionHooksRepositoryPort {
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
}

export interface RunCompletionHooksWorkspaceChangeReadPort {
  listChangedFilesByRun(runId: string): WorkspaceChangedFile[];
}

export interface RunCompletionHooksMemoryCaptureService {
  evaluateRunCompletedCapture(input: {
    homePath: string;
    runId: string;
    sessionId: string;
    projectId?: string | null;
    providerId?: ProviderId | null;
    modelId?: string | null;
    runStatus: 'completed';
    userText: string;
    assistantText?: string;
    toolActivitySummary?: string;
    signals?: MemoryCaptureSignal[];
    memoryEnabled?: boolean;
    hasProject?: boolean;
  }): Promise<{ status: string; reason?: string; savedMemoryIds?: string[] }>;
}

export interface RunCompletionHooksCoordinatorOptions {
  repository: RunCompletionHooksRepositoryPort;
  memoryCaptureService?: RunCompletionHooksMemoryCaptureService;
  megumiHomePath?: string;
  workspaceChanges?: RunCompletionHooksWorkspaceChangeReadPort;
  workspaceChangeFooterProjector?: WorkspaceChangeFooterProjectorService;
}

export interface ScheduleRunCompletedMemoryCaptureInput {
  runId: string;
  sessionId: string;
  projectId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  userText: string;
  assistantText: string;
  hasProject: boolean;
  memoryEnabled?: boolean;
}

export class RunCompletionHooksCoordinator {
  private readonly repository: RunCompletionHooksRepositoryPort;
  private readonly memoryCaptureService?: RunCompletionHooksMemoryCaptureService;
  private readonly megumiHomePath?: string;
  private readonly workspaceChanges?: RunCompletionHooksWorkspaceChangeReadPort;
  private readonly workspaceChangeFooterProjector?: WorkspaceChangeFooterProjectorService;

  constructor(options: RunCompletionHooksCoordinatorOptions) {
    this.repository = options.repository;
    this.memoryCaptureService = options.memoryCaptureService;
    this.megumiHomePath = options.megumiHomePath;
    this.workspaceChanges = options.workspaceChanges;
    this.workspaceChangeFooterProjector = options.workspaceChangeFooterProjector;
  }

  scheduleRunCompletedMemoryCapture(input: ScheduleRunCompletedMemoryCaptureInput): void {
    if (!this.memoryCaptureService || !this.megumiHomePath) {
      return;
    }

    // Capture is a hidden post-completion hook. It must never write transcript
    // messages or alter the already completed user-visible run stream.
    const activity = this.createMemoryCaptureActivitySummary(input.runId);
    void this.memoryCaptureService.evaluateRunCompletedCapture({
      homePath: this.megumiHomePath,
      runId: input.runId,
      sessionId: input.sessionId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.providerId && isProviderId(input.providerId) ? { providerId: input.providerId } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      runStatus: 'completed',
      userText: input.userText,
      assistantText: input.assistantText,
      ...(activity.summary ? { toolActivitySummary: activity.summary } : {}),
      ...(activity.signals.length > 0 ? { signals: activity.signals } : {}),
      ...(typeof input.memoryEnabled === 'boolean' ? { memoryEnabled: input.memoryEnabled } : {}),
      hasProject: input.hasProject,
    }).catch(() => {
      // Memory capture is best-effort. Runtime diagnostics are handled inside
      // the memory service when available; session-run must not fail here.
    });
  }

  publishWorkspaceChangeFooter(input: {
    runId: string;
    createdAt: string;
    chatStreamAdapter?: Pick<ChatStreamEventAdapter, 'publishWorkspaceChangeFooter'>;
  }): void {
    if (!input.chatStreamAdapter || !this.workspaceChangeFooterProjector) {
      return;
    }

    const footer = this.workspaceChangeFooterProjector.projectRunFooter(input.runId);
    if (!footer) {
      return;
    }

    input.chatStreamAdapter.publishWorkspaceChangeFooter?.(footer, input.createdAt);
  }

  private createMemoryCaptureActivitySummary(runId: string): { signals: MemoryCaptureSignal[]; summary?: string } {
    const summaryParts: string[] = [];
    const signals = new Set<MemoryCaptureSignal>();
    const sourceFiles = this.listSourceOfTruthChangedFiles(runId);
    if (sourceFiles.length > 0) {
      signals.add('source_of_truth_doc_changed');
      summaryParts.push(`Source-of-truth files changed: ${sourceFiles.slice(0, 5).join(', ')}`);
    }

    const toolSummaries = this.repository.listRuntimeEventsByRun(runId)
      .filter((event) => event.eventType === 'tool.result.created')
      .map((event) => {
        if (!isObjectRecord(event.payload) || typeof event.payload.summary !== 'string') {
          return undefined;
        }
        return clipMemoryRuntimeSummary(event.payload.summary);
      })
      .filter((summary): summary is string => Boolean(summary));
    if (toolSummaries.length > 0) {
      summaryParts.push(`Tool results observed: ${toolSummaries.slice(0, 5).join(' | ')}`);
    }

    const summary = clipMemoryRuntimeSummary(summaryParts.join('\n'), 1200);
    return {
      signals: [...signals],
      ...(summary ? { summary } : {}),
    };
  }

  private listSourceOfTruthChangedFiles(runId: string): string[] {
    if (!this.workspaceChanges) {
      return [];
    }
    try {
      return this.workspaceChanges.listChangedFilesByRun(runId)
        .map((file) => file.projectPath)
        .filter((projectPath) => isSourceOfTruthMemoryPath(projectPath));
    } catch {
      return [];
    }
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSourceOfTruthMemoryPath(projectPath: string): boolean {
  const normalized = projectPath.replace(/\\/g, '/').toLowerCase();
  return normalized === 'agents.md'
    || normalized === 'readme.md'
    || normalized.startsWith('.local-docs/specs/')
    || normalized.startsWith('.local-docs/architecture/')
    || normalized.startsWith('.local-docs/decisions/');
}

function clipMemoryRuntimeSummary(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}
