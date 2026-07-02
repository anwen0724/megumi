// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  ToolSetService,
  type ToolSetRegistryProvider,
} from '@megumi/coding-agent/agent-loop';
import type { RegisteredTool } from '@megumi/coding-agent/tools';

describe('ToolSetService', () => {
  it('builds model-visible ToolSet definitions from registered tools', () => {
    const registryProvider: ToolSetRegistryProvider = {
      listAvailableTools: vi.fn(() => ({
        tools: [
          registeredTool('read_file'),
          registeredTool('list_directory'),
          registeredTool('glob'),
          registeredTool('search_text'),
          registeredTool('edit_file'),
          registeredTool('write_file'),
          registeredTool('run_command'),
        ],
      })),
    };
    const service = new ToolSetService({ registryProvider });

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

    expect(registryProvider.listAvailableTools).toHaveBeenCalledWith();
    expect(result.toolDefinitions?.map((tool) => tool.name)).toEqual([
      'read_file',
      'list_directory',
      'glob',
      'search_text',
      'edit_file',
      'write_file',
      'run_command',
    ]);
    expect(result.events).toEqual([]);
  });

  it('uses model-facing descriptions when present', () => {
    const registryProvider: ToolSetRegistryProvider = {
      listAvailableTools: vi.fn(() => ({
        tools: [registeredTool('read_file', {
          description: 'internal description',
          modelFacingDescription: 'model description',
        })],
      })),
    };
    const service = new ToolSetService({ registryProvider });

    const result = service.prepareToolSet(baseInput());

    expect(result.toolDefinitions?.[0]).toMatchObject({
      name: 'read_file',
      description: 'model description',
    });
  });

  it('resolves provider capability before preparing the ToolSet', () => {
    const registryProvider: ToolSetRegistryProvider = {
      listAvailableTools: vi.fn(() => ({ tools: [registeredTool('read_file')] })),
    };
    const service = new ToolSetService({
      registryProvider,
      capabilityProvider: {
        getProviderCapabilitySummary: vi.fn(() => ({ supportsToolCall: false })),
      },
    });

    const result = service.prepareToolSet({
      ...baseInput(),
      providerCapabilitySummary: undefined,
    });

    expect(result.toolDefinitions).toEqual([]);
    expect(registryProvider.listAvailableTools).not.toHaveBeenCalled();
  });

  it('returns no ToolSet when no workspace-backed registry exists', () => {
    const registryProvider: ToolSetRegistryProvider = {
      listAvailableTools: vi.fn(() => ({ tools: [registeredTool('read_file')] })),
    };
    const service = new ToolSetService({ registryProvider });

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

    expect(registryProvider.listAvailableTools).not.toHaveBeenCalled();
    expect(result).toEqual({ events: [] });
  });
});

const createdAt = '2026-06-21T00:00:00.000Z';

function baseInput() {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    projectRoot: 'C:/repo',
    permissionMode: 'default' as const,
    providerId: 'openai',
    modelId: 'gpt-test',
    createdAt,
    providerCapabilitySummary: { supportsToolCall: true },
    startSequence: 0,
  };
}

function registeredTool(
  name: string,
  overrides: Partial<RegisteredTool['definition']> = {},
): RegisteredTool {
  return {
    identity: {
      sourceId: 'built_in',
      namespace: 'megumi',
      sourceToolName: name,
    },
    registeredToolName: name,
    status: 'available',
    source: {
      sourceId: 'built_in',
      sourceKind: 'built_in',
      namespace: 'megumi',
      displayName: 'Built-in tools',
      configured: true,
      enabled: true,
      availabilityStatus: 'available',
    },
    definition: {
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
      ...overrides,
    },
  };
}
