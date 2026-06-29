// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createToolSetSnapshotProvider,
  ToolSetService,
  type ToolSetRegistryProvider,
  type ToolSetSnapshotProvider,
} from '@megumi/coding-agent/agent-loop';
import { createRuntimeEvent } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ToolDefinition } from '@megumi/shared/tool';
import type {
  RunToolRegistrySnapshotBuildResult,
  ToolRegistrySnapshotServicePort,
} from '@megumi/coding-agent/tools/tool-registry-snapshot';

describe('ToolSetService', () => {
  it('uses the run snapshot when project identity is available and normalizes snapshot event sequence', () => {
    const snapshotEvent = runtimeEvent('tool.registry.snapshot.created', 0);
    const snapshotProvider: ToolSetSnapshotProvider = {
      createRunSnapshot: vi.fn(() => ({
        modelVisibleToolDefinitions: [toolDefinition('read_file')],
        events: [snapshotEvent],
      })),
    };
    const registryProvider: ToolSetRegistryProvider = {
      listDefinitions: vi.fn(() => [toolDefinition('fallback')]),
    };
    const service = new ToolSetService({
      snapshotProvider,
      registryProvider,
    });

    const result = service.prepareToolSet({
      runId: 'run-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      projectRoot: 'C:/repo',
      permissionMode: 'default',
      providerId: 'openai',
      modelId: 'gpt-test',
      createdAt,
      providerCapabilitySummary: { supportsToolCall: true },
      startSequence: 3,
    });

    expect(snapshotProvider.createRunSnapshot).toHaveBeenCalledWith({
      runId: 'run-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      permissionMode: 'default',
      modelId: 'gpt-test',
      createdAt,
      providerCapabilitySummary: { supportsToolCall: true },
    });
    expect(registryProvider.listDefinitions).not.toHaveBeenCalled();
    expect(result.toolDefinitions?.map((definition) => definition.name)).toEqual(['read_file']);
    expect(result.events).toEqual([
      expect.objectContaining({
        eventType: 'tool.registry.snapshot.created',
        sequence: 4,
      }),
    ]);
  });

  it('resolves provider capability before preparing the ToolSet', () => {
    const snapshotProvider: ToolSetSnapshotProvider = {
      createRunSnapshot: vi.fn(() => ({
        modelVisibleToolDefinitions: [],
        events: [],
      })),
    };
    const service = new ToolSetService({
      snapshotProvider,
      capabilityProvider: {
        getProviderCapabilitySummary: vi.fn(() => ({ supportsToolCall: false })),
      },
    });

    service.prepareToolSet({
      runId: 'run-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      projectRoot: 'C:/repo',
      permissionMode: 'default',
      providerId: 'openai',
      modelId: 'gpt-test',
      createdAt,
      startSequence: 0,
    });

    expect(snapshotProvider.createRunSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      providerCapabilitySummary: { supportsToolCall: false },
    }));
  });

  it('adapts a tool registry snapshot into model-visible ToolSet definitions and runtime events', () => {
    let eventIndex = 0;
    const snapshotResult: RunToolRegistrySnapshotBuildResult = {
      snapshot: {
        snapshotId: 'snapshot-1',
        runId: 'run-1',
        projectId: 'project-1',
        permissionMode: 'default',
        modelId: 'gpt-test',
        createdAt,
        registryVersion: 1,
        sourceVersionHash: 'hash-1',
        sourceEntries: [{
          sourceId: 'built_in',
          sourceKind: 'built_in',
          namespace: 'megumi',
          displayName: 'Built-in tools',
          configured: true,
          enabled: true,
          availabilityStatus: 'available',
        }],
        entries: [{
          snapshotEntryId: 'entry-1',
          snapshotId: 'snapshot-1',
          registrationId: 'registration-1',
          canonicalToolId: 'built_in:megumi:read_file',
          modelVisibleName: 'read_file',
          sourceId: 'built_in',
          namespace: 'megumi',
          sourceToolName: 'read_file',
          definition: toolDefinition('read_file'),
          effectiveStatus: 'available',
          exposedToModel: true,
          executionMode: 'serial',
          createdAt,
        }],
      },
      modelVisibleToolDefinitions: [toolDefinition('read_file')],
      diagnostics: {
        sourceIds: ['built_in'],
        createdSourceIds: ['built_in'],
        modelSupportsToolCall: true,
        modelVisibleToolNames: ['read_file'],
        hiddenCount: 0,
      },
    };
    const snapshotService: ToolRegistrySnapshotServicePort = {
      createRunSnapshot: vi.fn(() => snapshotResult),
    };
    const provider = createToolSetSnapshotProvider({
      snapshotService,
      eventId: () => `event-${eventIndex += 1}`,
    });

    const result = provider.createRunSnapshot({
      runId: 'run-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      permissionMode: 'default',
      modelId: 'gpt-test',
      createdAt,
      providerCapabilitySummary: { supportsToolCall: true },
    });

    expect(snapshotService.createRunSnapshot).toHaveBeenCalledWith({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      modelId: 'gpt-test',
      createdAt,
      providerCapabilitySummary: { supportsToolCall: true },
    });
    expect(result.modelVisibleToolDefinitions.map((definition) => definition.name)).toEqual(['read_file']);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'tool.registry.sources.ensured',
      'tool.registry.snapshot.created',
      'tool.registry.entry.resolved',
      'tool.registry.model_visible_tools.derived',
    ]);
    expect(result.events[2]?.payload).toMatchObject({
      snapshotEntryId: 'entry-1',
      modelVisibleName: 'read_file',
      effectiveStatus: 'available',
      exposedToModel: true,
    });
    expect(result.events[3]?.payload).toMatchObject({
      snapshotId: 'snapshot-1',
      modelId: 'gpt-test',
      modelSupportsToolCall: true,
      toolNames: ['read_file'],
      hiddenCount: 0,
    });
  });

  it('falls back to the live registry only when there is a workspace root without project snapshot identity', () => {
    const registryProvider: ToolSetRegistryProvider = {
      listDefinitions: vi.fn(() => [toolDefinition('read_file')]),
    };
    const service = new ToolSetService({
      registryProvider,
    });

    const result = service.prepareToolSet({
      runId: 'run-1',
      sessionId: 'session-1',
      projectRoot: 'C:/repo',
      permissionMode: 'plan',
      providerId: 'openai',
      modelId: 'gpt-test',
      createdAt,
      providerCapabilitySummary: { supportsToolCall: false },
      startSequence: 1,
    });

    expect(registryProvider.listDefinitions).toHaveBeenCalledWith({
      runId: 'run-1',
      permissionMode: 'plan',
      providerCapabilitySummary: { supportsToolCall: false },
    });
    expect(result).toEqual({
      toolDefinitions: [toolDefinition('read_file')],
      events: [],
    });
  });

  it('returns no ToolSet when no workspace-backed registry exists', () => {
    const registryProvider: ToolSetRegistryProvider = {
      listDefinitions: vi.fn(() => [toolDefinition('read_file')]),
    };
    const service = new ToolSetService({
      registryProvider,
    });

    const result = service.prepareToolSet({
      runId: 'run-1',
      sessionId: 'session-1',
      permissionMode: 'default',
      providerId: 'openai',
      modelId: 'gpt-test',
      createdAt,
      providerCapabilitySummary: { supportsToolCall: true },
      startSequence: 0,
    });

    expect(registryProvider.listDefinitions).not.toHaveBeenCalled();
    expect(result).toEqual({ events: [] });
  });
});

const createdAt = '2026-06-21T00:00:00.000Z';

function toolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    availability: { status: 'available' },
  };
}

function runtimeEvent(eventType: 'tool.registry.snapshot.created', sequence: number): RuntimeEvent {
  return createRuntimeEvent({
    eventId: `event:${eventType}`,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence,
    createdAt,
    source: 'core',
    visibility: 'system',
    persist: 'required',
    payload: {
      snapshotId: 'tool-registry-snapshot-run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      modelId: 'gpt-test',
      registryVersion: 1,
      sourceVersionHash: 'hash',
      sourceCount: 1,
      entryCount: 1,
      exposedCount: 1,
    },
  });
}
