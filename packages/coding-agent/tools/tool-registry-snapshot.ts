// Builds and persists run-level tool registry snapshots by composing durable source state with platform-neutral registry resolution.
import type { PermissionMode } from '@megumi/shared/permission';
import type { ToolDefinition, ToolRegistrySnapshot, ToolSource } from '@megumi/shared/tool';
import {
  createToolRegistrySnapshot,
  getToolRegistrySnapshotResolutionTrace,
  listModelVisibleToolDefinitions,
} from './registry';
import {
  createBuiltInToolRegistrations,
  createExternalTestToolRegistrations,
} from './sources';

export interface ToolRegistrySnapshotRepositoryPort {
  getToolSource(sourceId: string): ToolSource | undefined;
  listToolSources(): ToolSource[];
  seedDefaultToolSources(createdAt: string): void;
  saveToolRegistrySnapshot(snapshot: ToolRegistrySnapshot): ToolRegistrySnapshot;
  getToolRegistrySnapshotByRun(runId: string): ToolRegistrySnapshot | undefined;
}

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

export interface ToolRegistrySnapshotServicePort {
  createRunSnapshot(input: RunToolRegistrySnapshotBuildInput): RunToolRegistrySnapshotBuildResult;
}

export class ToolRegistrySnapshotService {
  constructor(private readonly repository: ToolRegistrySnapshotRepositoryPort) {}

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
