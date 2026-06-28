// Owns the tool system surface that prepares model-visible tool definitions for one run.
import type { PermissionMode } from '@megumi/shared/permission';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ToolDefinition } from '@megumi/shared/tool';

export interface RunModelVisibleToolRegistrySnapshotProvider {
  createRunSnapshot(input: {
    runId: string;
    sessionId: string;
    projectId: string;
    permissionMode: PermissionMode;
    modelId: string;
    createdAt: string;
    providerCapabilitySummary?: { supportsToolCall?: boolean };
  }): {
    modelVisibleToolDefinitions: ToolDefinition[];
    events: RuntimeEvent[];
  };
}

export interface RunModelVisibleToolRegistryProvider {
  listDefinitions(input: {
    runId: string;
    permissionMode: PermissionMode;
    providerCapabilitySummary?: { supportsToolCall?: boolean };
  }): ToolDefinition[];
}

export interface PrepareModelVisibleToolDefinitionsInput {
  runId: string;
  sessionId: string;
  projectId?: string;
  projectRoot?: string;
  permissionMode: PermissionMode;
  modelId: string;
  createdAt: string;
  providerCapabilitySummary?: { supportsToolCall?: boolean };
  startSequence: number;
}

export interface PrepareModelVisibleToolDefinitionsResult {
  toolDefinitions?: ToolDefinition[];
  events: RuntimeEvent[];
}

export interface ModelVisibleToolDefinitionServiceOptions {
  snapshotProvider?: RunModelVisibleToolRegistrySnapshotProvider;
  registryProvider?: RunModelVisibleToolRegistryProvider;
}

export class ModelVisibleToolDefinitionService {
  constructor(private readonly options: ModelVisibleToolDefinitionServiceOptions = {}) {}

  prepareModelVisibleToolDefinitions(
    input: PrepareModelVisibleToolDefinitionsInput,
  ): PrepareModelVisibleToolDefinitionsResult {
    if (input.projectRoot && input.projectId && this.options.snapshotProvider) {
      const snapshot = this.options.snapshotProvider.createRunSnapshot({
        runId: input.runId,
        sessionId: input.sessionId,
        projectId: input.projectId,
        permissionMode: input.permissionMode,
        modelId: input.modelId,
        createdAt: input.createdAt,
        providerCapabilitySummary: input.providerCapabilitySummary,
      });
      return {
        toolDefinitions: snapshot.modelVisibleToolDefinitions,
        events: normalizeEventSequence(snapshot.events, input.startSequence),
      };
    }

    if (input.projectRoot && this.options.registryProvider) {
      return {
        toolDefinitions: this.options.registryProvider.listDefinitions({
          runId: input.runId,
          permissionMode: input.permissionMode,
          providerCapabilitySummary: input.providerCapabilitySummary,
        }),
        events: [],
      };
    }

    return { events: [] };
  }
}

function normalizeEventSequence(events: RuntimeEvent[], startSequence: number): RuntimeEvent[] {
  return events.map((event, index) => ({
    ...event,
    sequence: event.sequence > startSequence ? event.sequence : startSequence + index + 1,
  }));
}
