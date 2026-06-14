import { describe, expect, it } from 'vitest';
import {
  createStaticToolRegistry,
  createToolRegistrySnapshot,
  listModelVisibleToolDefinitions,
} from '@megumi/tools/registry';
import { BUILT_IN_TOOL_NAMES } from '@megumi/tools/built-ins';
import {
  createBuiltInToolRegistrations,
  createExternalTestToolRegistrations,
} from '@megumi/tools/sources';
import type { ToolDefinition, ToolRegistration, ToolSource } from '@megumi/shared/tool';

const readTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a normal project file.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  annotations: { readOnlyHint: true },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
};

const disabledTool: ToolDefinition = {
  name: 'run_command',
  description: 'Run a project-scoped command.',
  inputSchema: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
  },
  annotations: { destructiveHint: true },
  capabilities: ['command_run'],
  riskLevel: 'high',
  sideEffect: 'execute_command',
  availability: { status: 'disabled', reason: 'Command tools disabled.' },
};

describe('createStaticToolRegistry', () => {
  it('lists only available tools for provider-facing use', () => {
    const registry = createStaticToolRegistry([readTool, disabledTool]);

    expect(registry.listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
    })).toEqual([readTool]);
  });

  it('hides tools when the provider cannot use tools', () => {
    const registry = createStaticToolRegistry([readTool]);

    expect(registry.listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      providerCapabilitySummary: { supportsToolCall: false },
    })).toEqual([]);
    expect(registry.getDefinition('read_file', {
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      providerCapabilitySummary: { supportsToolCall: false },
    })).toBeUndefined();
  });

  it('supports destructured getDefinition with visibility input', () => {
    const { getDefinition } = createStaticToolRegistry([readTool]);

    expect(getDefinition('read_file', {
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
    })?.name).toBe('read_file');
  });

  it('finds definitions by Claude-compatible tool name', () => {
    const registry = createStaticToolRegistry([readTool]);

    expect(registry.getDefinition('read_file')?.description).toContain('Read');
    expect(registry.getDefinition('workspace.file.read')).toBeUndefined();
  });

  it('prevents caller mutation from changing registry availability or order', () => {
    const registry = createStaticToolRegistry([readTool, {
      ...readTool,
      name: 'list_directory',
      description: 'List a project directory.',
    }]);
    const firstList = registry.listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
    });

    firstList[0].availability.status = 'disabled';
    firstList[1].capabilities.push('command_run');

    expect(registry.listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
    }).map((definition) => definition.name)).toEqual(['read_file', 'list_directory']);
    expect(registry.getDefinition('read_file')?.availability.status).toBe('available');
    expect(registry.getDefinition('list_directory')?.capabilities).toEqual(['project_read']);
  });

  it('rejects duplicate tool names', () => {
    expect(() => createStaticToolRegistry([readTool, readTool])).toThrow(/Duplicate tool name/);
  });
});

describe('createToolRegistrySnapshot', () => {
  it('creates run-level snapshots with built-in tools exposed and external_test hidden by default', () => {
    const snapshot = createToolRegistrySnapshot(createSnapshotInput());

    expect(snapshot.entries).toHaveLength(8);
    expect(snapshot.entries.filter((entry) => entry.sourceId === 'built_in')).toEqual(
      expect.arrayContaining(BUILT_IN_TOOL_NAMES.map((name) => expect.objectContaining({
        sourceToolName: name,
        effectiveStatus: 'available',
        exposedToModel: true,
      }))),
    );
    expect(snapshot.entries.find((entry) => entry.sourceId === 'external_test')).toMatchObject({
      modelVisibleName: 'demo_echo',
      effectiveStatus: 'disabled',
      disabledReason: 'source_disabled',
      exposedToModel: false,
    });
  });

  it('uses namespace-prefixed model visible names for enabled external registrations', () => {
    const snapshot = createToolRegistrySnapshot(createSnapshotInput({
      sources: [
        createSource({ sourceId: 'built_in', sourceKind: 'built_in', namespace: 'megumi', enabled: true }),
        createSource({ sourceId: 'external_test', sourceKind: 'external_test', namespace: 'demo', enabled: true }),
      ],
    }));

    expect(snapshot.entries.find((entry) => entry.modelVisibleName === 'demo_echo')).toMatchObject({
      effectiveStatus: 'available',
      exposedToModel: true,
    });
    const modelDefinition = listModelVisibleToolDefinitions(snapshot).find((definition) => definition.name === 'demo_echo');
    expect(modelDefinition).toBeDefined();
    expect(modelDefinition).not.toHaveProperty('sourceId');
    expect(modelDefinition).not.toHaveProperty('namespace');
    expect(modelDefinition).not.toHaveProperty('canonicalToolId');
    expect(modelDefinition).not.toHaveProperty('registrySnapshotId');
    expect(modelDefinition?.description).toBe('Echo a message through the demo external test tool.');
  });

  it('keeps built-in model visible names stable', () => {
    const snapshot = createToolRegistrySnapshot(createSnapshotInput());
    const builtInEntries = snapshot.entries.filter((entry) => entry.sourceId === 'built_in');

    expect(builtInEntries.map((entry) => entry.modelVisibleName)).toEqual(BUILT_IN_TOOL_NAMES);
    expect(builtInEntries.map((entry) => entry.canonicalToolId)).toEqual(
      BUILT_IN_TOOL_NAMES.map((name) => `built_in:megumi:${name}`),
    );
  });

  it('records unavailable sources without exposing their tools', () => {
    const snapshot = createToolRegistrySnapshot(createSnapshotInput({
      sources: [
        createSource({
          sourceId: 'built_in',
          sourceKind: 'built_in',
          namespace: 'megumi',
          availabilityStatus: 'unavailable',
          availabilityReason: 'built-in host unavailable',
        }),
        createSource({ sourceId: 'external_test', sourceKind: 'external_test', namespace: 'demo', enabled: false }),
      ],
    }));

    expect(snapshot.entries.filter((entry) => entry.sourceId === 'built_in')).toEqual(
      expect.arrayContaining(BUILT_IN_TOOL_NAMES.map((name) => expect.objectContaining({
        sourceToolName: name,
        effectiveStatus: 'unavailable',
        unavailableReason: 'built-in host unavailable',
        exposedToModel: false,
      }))),
    );
  });

  it('records unavailable tool registrations without exposing them', () => {
    const registrations = createSnapshotInput().registrations.map((registration) =>
      registration.sourceToolName === 'read_file'
        ? { ...registration, availability: { status: 'unavailable' as const, reason: 'tool unavailable' } }
        : registration,
    );
    const snapshot = createToolRegistrySnapshot(createSnapshotInput({ registrations }));

    expect(snapshot.entries.find((entry) => entry.sourceToolName === 'read_file')).toMatchObject({
      effectiveStatus: 'unavailable',
      unavailableReason: 'tool unavailable',
      exposedToModel: false,
    });
  });

  it('hides all tools when the model does not support tool calls', () => {
    const snapshot = createToolRegistrySnapshot(createSnapshotInput({
      sources: [
        createSource({ sourceId: 'built_in', sourceKind: 'built_in', namespace: 'megumi', enabled: true }),
        createSource({ sourceId: 'external_test', sourceKind: 'external_test', namespace: 'demo', enabled: true }),
      ],
      providerCapabilitySummary: { supportsToolCall: false },
    }));

    expect(snapshot.entries.every((entry) => (
      entry.effectiveStatus !== 'available'
        && entry.disabledReason === 'model_tools_unsupported'
        && entry.exposedToModel === false
    ))).toBe(true);
    expect(listModelVisibleToolDefinitions(snapshot)).toEqual([]);
  });

  it('records permission mode without replacing permission policy', () => {
    const defaultSnapshot = createToolRegistrySnapshot(createSnapshotInput({ permissionMode: 'default' }));
    const planSnapshot = createToolRegistrySnapshot(createSnapshotInput({ permissionMode: 'plan' }));

    expect(defaultSnapshot.permissionMode).toBe('default');
    expect(planSnapshot.permissionMode).toBe('plan');
    expect(listModelVisibleToolDefinitions(defaultSnapshot).map((definition) => definition.name)).toEqual(
      listModelVisibleToolDefinitions(planSnapshot).map((definition) => definition.name),
    );
  });

  it('marks duplicate canonical identities as conflicted', () => {
    const registrations = createSnapshotInput().registrations;
    const duplicate = cloneRegistration(registrations[0]);
    duplicate.registrationId = 'tool-registration-built_in-read_file-duplicate';
    const snapshot = createToolRegistrySnapshot(createSnapshotInput({
      registrations: [...registrations, duplicate],
    }));

    const duplicatedEntries = snapshot.entries.filter((entry) => entry.canonicalToolId === 'built_in:megumi:read_file');
    expect(duplicatedEntries).toHaveLength(2);
    expect(new Set(duplicatedEntries.map((entry) => entry.snapshotEntryId)).size).toBe(2);
    expect(duplicatedEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        effectiveStatus: 'conflicted',
        conflictReason: expect.stringContaining('built_in:megumi:read_file'),
        exposedToModel: false,
      }),
    ]));
  });

  it('keeps built-in visible names exposed when an external registration resolves to the same model name', () => {
    const registrations = createSnapshotInput().registrations;
    const externalConflict = cloneRegistration(createExternalTestToolRegistrations()[0]);
    externalConflict.registrationId = 'tool-registration-external_test-read-file';
    externalConflict.namespace = 'read';
    externalConflict.sourceToolName = 'file';
    externalConflict.definition = {
      ...externalConflict.definition,
      name: 'file',
    };
    const snapshot = createToolRegistrySnapshot(createSnapshotInput({
      sources: [
        createSource({ sourceId: 'built_in', sourceKind: 'built_in', namespace: 'megumi', enabled: true }),
        createSource({ sourceId: 'external_test', sourceKind: 'external_test', namespace: 'read', enabled: true }),
      ],
      registrations: [...registrations, externalConflict],
    }));

    expect(snapshot.entries.find((entry) => entry.canonicalToolId === 'built_in:megumi:read_file')).toMatchObject({
      modelVisibleName: 'read_file',
      effectiveStatus: 'available',
      exposedToModel: true,
    });
    expect(snapshot.entries.find((entry) => entry.registrationId === externalConflict.registrationId)).toMatchObject({
      modelVisibleName: 'read_file',
      effectiveStatus: 'conflicted',
      conflictReason: expect.stringContaining('read_file'),
      exposedToModel: false,
    });
  });

  it('marks non-built-in model visible name conflicts as conflicted', () => {
    const externalA = cloneRegistration(createExternalTestToolRegistrations()[0]);
    const externalB = cloneRegistration(createExternalTestToolRegistrations()[0]);
    externalB.registrationId = 'tool-registration-another_external-echo';
    externalB.sourceId = 'another_external';
    const snapshot = createToolRegistrySnapshot(createSnapshotInput({
      sources: [
        createSource({ sourceId: 'external_test', sourceKind: 'external_test', namespace: 'demo', enabled: true }),
        createSource({ sourceId: 'another_external', sourceKind: 'external_test', namespace: 'demo', enabled: true }),
      ],
      registrations: [externalA, externalB],
    }));

    const conflictedEntries = snapshot.entries.filter((entry) => entry.modelVisibleName === 'demo_echo');
    expect(conflictedEntries).toHaveLength(2);
    expect(conflictedEntries.every((entry) => (
      entry.effectiveStatus === 'conflicted' && entry.exposedToModel === false
    ))).toBe(true);
  });

  it('deep clones snapshot definitions and model visible definitions', () => {
    const snapshot = createToolRegistrySnapshot(createSnapshotInput());
    const visibleDefinitions = listModelVisibleToolDefinitions(snapshot);

    visibleDefinitions[0].description = 'mutated';
    snapshot.entries[0].definition.description = 'mutated snapshot';

    expect(listModelVisibleToolDefinitions(snapshot)[0].description).not.toBe('mutated');
    expect(createToolRegistrySnapshot(createSnapshotInput()).entries[0].definition.description).not.toBe('mutated snapshot');
  });
});

function createSource(overrides: Partial<ToolSource> = {}): ToolSource {
  return {
    sourceId: 'built_in',
    sourceKind: 'built_in',
    namespace: 'megumi',
    displayName: 'Built-in tools',
    configured: true,
    enabled: true,
    availabilityStatus: 'available',
    config: {},
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

function createSnapshotInput(overrides: Partial<Parameters<typeof createToolRegistrySnapshot>[0]> = {}) {
  return {
    runId: 'run-1',
    projectId: 'project-1',
    permissionMode: 'default' as const,
    modelId: 'gpt-5',
    createdAt: '2026-06-14T00:00:00.000Z',
    sources: [
      createSource({ sourceId: 'built_in', sourceKind: 'built_in', namespace: 'megumi', enabled: true }),
      createSource({ sourceId: 'external_test', sourceKind: 'external_test', namespace: 'demo', enabled: false }),
    ],
    registrations: [
      ...createBuiltInToolRegistrations(),
      ...createExternalTestToolRegistrations(),
    ],
    providerCapabilitySummary: { supportsToolCall: true },
    ...overrides,
  };
}

function cloneRegistration(registration: ToolRegistration): ToolRegistration {
  return JSON.parse(JSON.stringify(registration)) as ToolRegistration;
}

