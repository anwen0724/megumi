// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  ModelVisibleToolDefinitionService,
  type RunModelVisibleToolRegistrySnapshotProvider,
  type RunModelVisibleToolRegistryProvider,
} from '@megumi/coding-agent/tools';
import { createRuntimeEvent } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ToolDefinition } from '@megumi/shared/tool';

describe('ModelVisibleToolDefinitionService', () => {
  it('uses the run snapshot owner when project identity is available and normalizes snapshot event sequence', () => {
    const snapshotEvent = runtimeEvent('tool.registry.snapshot.created', 0);
    const snapshotProvider: RunModelVisibleToolRegistrySnapshotProvider = {
      createRunSnapshot: vi.fn(() => ({
        modelVisibleToolDefinitions: [toolDefinition('read_file')],
        events: [snapshotEvent],
      })),
    };
    const registryProvider: RunModelVisibleToolRegistryProvider = {
      listDefinitions: vi.fn(() => [toolDefinition('fallback')]),
    };
    const service = new ModelVisibleToolDefinitionService({
      snapshotProvider,
      registryProvider,
    });

    const result = service.prepareModelVisibleToolDefinitions({
      runId: 'run-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      projectRoot: 'C:/repo',
      permissionMode: 'default',
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

  it('falls back to the live registry only when there is a workspace root without project snapshot identity', () => {
    const registryProvider: RunModelVisibleToolRegistryProvider = {
      listDefinitions: vi.fn(() => [toolDefinition('read_file')]),
    };
    const service = new ModelVisibleToolDefinitionService({
      registryProvider,
    });

    const result = service.prepareModelVisibleToolDefinitions({
      runId: 'run-1',
      sessionId: 'session-1',
      projectRoot: 'C:/repo',
      permissionMode: 'plan',
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

  it('returns no model-visible tools when no workspace-backed tool surface exists', () => {
    const registryProvider: RunModelVisibleToolRegistryProvider = {
      listDefinitions: vi.fn(() => [toolDefinition('read_file')]),
    };
    const service = new ModelVisibleToolDefinitionService({
      registryProvider,
    });

    const result = service.prepareModelVisibleToolDefinitions({
      runId: 'run-1',
      sessionId: 'session-1',
      permissionMode: 'default',
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
