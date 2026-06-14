// Builds and persists run-level tool registry snapshots by composing durable source state with platform-neutral registry resolution.
import type { PermissionMode } from '@megumi/shared/permission';
import type { ToolDefinition, ToolRegistrySnapshot } from '@megumi/shared/tool';
import type { ToolRepository } from '@megumi/db/repos/tool.repo';
import {
  createToolRegistrySnapshot,
  getToolRegistrySnapshotResolutionTrace,
  listModelVisibleToolDefinitions,
} from '@megumi/tools/registry';
import {
  createBuiltInToolRegistrations,
  createExternalTestToolRegistrations,
} from '@megumi/tools/sources';

export interface RunToolRegistrySnapshotBuildInput {
  runId: string;
  projectId: string;
  permissionMode: PermissionMode;
  modelId: string;
  createdAt: string;
  providerCapabilitySummary?: {
    supportsToolCall?: boolean;
  };
}

export interface RunToolRegistrySnapshotBuildResult {
  snapshot: ToolRegistrySnapshot;
  modelVisibleToolDefinitions: ToolDefinition[];
  diagnostics: {
    sourceIds: string[];
    createdSourceIds: string[];
    modelSupportsToolCall: boolean;
    modelVisibleToolNames: string[];
    hiddenCount: number;
  };
}

export class ToolRegistrySnapshotService {
  constructor(private readonly repository: Pick<
    ToolRepository,
    | 'getToolSource'
    | 'listToolSources'
    | 'seedDefaultToolSources'
    | 'saveToolRegistrySnapshot'
    | 'getToolRegistrySnapshotByRun'
  >) {}

  createRunSnapshot(input: RunToolRegistrySnapshotBuildInput): RunToolRegistrySnapshotBuildResult {
    const existingSnapshot = this.repository.getToolRegistrySnapshotByRun(input.runId);
    if (existingSnapshot) {
      return this.resultForSnapshot(existingSnapshot, input, []);
    }

    const existingSourceIds = new Set(this.repository.listToolSources().map((source) => source.sourceId));
    this.repository.seedDefaultToolSources(input.createdAt);
    const sources = this.repository.listToolSources();
    const createdSourceIds = sources
      .map((source) => source.sourceId)
      .filter((sourceId) => !existingSourceIds.has(sourceId));
    const registrations = [
      ...createBuiltInToolRegistrations(),
      ...createExternalTestToolRegistrations(),
    ];
    const snapshot = createToolRegistrySnapshot({
      ...input,
      sources,
      registrations,
    });

    this.repository.saveToolRegistrySnapshot(snapshot);
    return this.resultForSnapshot(snapshot, input, createdSourceIds);
  }

  private resultForSnapshot(
    snapshot: ToolRegistrySnapshot,
    input: RunToolRegistrySnapshotBuildInput,
    createdSourceIds: string[],
  ): RunToolRegistrySnapshotBuildResult {
    const modelSupportsToolCall = input.providerCapabilitySummary?.supportsToolCall !== false;
    const trace = getToolRegistrySnapshotResolutionTrace(snapshot, { modelSupportsToolCall });

    return {
      snapshot,
      modelVisibleToolDefinitions: listModelVisibleToolDefinitions(snapshot),
      diagnostics: {
        sourceIds: trace.sourceIds,
        createdSourceIds,
        modelSupportsToolCall: trace.modelSupportsToolCall,
        modelVisibleToolNames: trace.modelVisibleToolNames,
        hiddenCount: trace.hiddenCount,
      },
    };
  }
}
