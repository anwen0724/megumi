import type { PermissionMode } from '@megumi/shared/permission';
import {
  ToolNameSchema,
  type CanonicalToolId,
  type SnapshotToolEntry,
  type ToolDefinition,
  type ToolRegistration,
  type ToolRegistrySnapshot,
  type ToolRegistrySnapshotSourceEntry,
  type ToolSourceIdentity,
  type ToolSource,
} from '@megumi/shared/tool';

export interface ToolRegistryListInput {
  runId: string;
  projectId?: string;
  permissionMode: PermissionMode;
  providerCapabilitySummary?: {
    supportsToolCall?: boolean;
  };
}

export interface ToolRegistry {
  listDefinitions<TInput extends ToolRegistryListInput>(input: TInput): ToolDefinition[];
  getDefinition<TInput extends ToolRegistryListInput>(toolName: string, input?: TInput): ToolDefinition | undefined;
}

export interface ToolRegistrySnapshotResolutionInput {
  runId: string;
  projectId: string;
  permissionMode: PermissionMode;
  modelId: string;
  createdAt: string;
  sources: ToolSource[];
  registrations: ToolRegistration[];
  providerCapabilitySummary?: {
    supportsToolCall?: boolean;
  };
  registryVersion?: number;
}

export interface ToolRegistrySnapshotResolutionTrace {
  sourceIds: string[];
  entryCount: number;
  exposedCount: number;
  hiddenCount: number;
  modelSupportsToolCall: boolean;
  modelVisibleToolNames: string[];
}

export type ToolCallSnapshotResolution =
  | {
      ok: true;
      entry: SnapshotToolEntry;
      sourceIdentity: ToolSourceIdentity;
      definition: ToolDefinition;
    }
  | {
      ok: false;
      reason:
        | 'unknown_tool'
        | 'tool_disabled'
        | 'tool_unavailable'
        | 'tool_conflicted'
        | 'tool_not_exposed';
      message: string;
      entry?: SnapshotToolEntry;
      sourceIdentity?: ToolSourceIdentity;
    };

function cloneToolDefinition(definition: ToolDefinition): ToolDefinition {
  return JSON.parse(JSON.stringify(definition)) as ToolDefinition;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
    Object.freeze(value);
  }
  return value;
}

export function createStaticToolRegistry(definitions: readonly ToolDefinition[]): ToolRegistry {
  const byName = new Map<string, ToolDefinition>();

  for (const definition of definitions) {
    if (byName.has(definition.name)) {
      throw new Error(`Duplicate tool name: ${definition.name}`);
    }
    byName.set(definition.name, deepFreeze(cloneToolDefinition(definition)));
  }

  function listVisibleDefinitions(input: ToolRegistryListInput): ToolDefinition[] {
    if (input.providerCapabilitySummary?.supportsToolCall === false) {
      return [];
    }

    return [...byName.values()].filter((definition) => definition.availability.status === 'available');
  }

  return {
    listDefinitions(input) {
      return listVisibleDefinitions(input).map(cloneToolDefinition);
    },
    getDefinition(toolName, input) {
      const definition = byName.get(toolName);
      if (!definition) {
        return undefined;
      }
      if (input && !listVisibleDefinitions(input).some((visible) => visible.name === toolName)) {
        return undefined;
      }
      return cloneToolDefinition(definition);
    },
  };
}

export function createToolRegistrySnapshot(
  input: ToolRegistrySnapshotResolutionInput,
): ToolRegistrySnapshot {
  const registryVersion = input.registryVersion ?? 1;
  const snapshotId = `tool-registry-snapshot-${input.runId}`;
  const sourceById = new Map(input.sources.map((source) => [source.sourceId, source]));
  const modelSupportsToolCall = input.providerCapabilitySummary?.supportsToolCall !== false;
  const sourceEntries = input.sources.map(sourceEntryFor);
  const entries = input.registrations.map((registration) => {
    const canonicalToolId = canonicalToolIdFor(registration);
    const modelVisibleName = modelVisibleNameFor(registration);
    const status = resolveEntryStatus({
      registration,
      source: sourceById.get(registration.sourceId),
      modelSupportsToolCall,
    });

    return {
      snapshotEntryId: `tool-registry-snapshot-entry-${input.runId}-${safeIdSegment(registration.registrationId)}-${canonicalToolId.replaceAll(':', '-')}`,
      snapshotId,
      registrationId: registration.registrationId,
      canonicalToolId,
      modelVisibleName,
      sourceId: registration.sourceId,
      namespace: registration.namespace,
      sourceToolName: registration.sourceToolName,
      definition: cloneToolDefinition(registration.definition),
      ...status,
      exposedToModel: status.effectiveStatus === 'available',
      executionMode: registration.definition.executionMode ?? 'sequential',
      createdAt: input.createdAt,
    } satisfies SnapshotToolEntry;
  });

  applyCanonicalConflicts(entries);
  applyModelVisibleNameConflicts(entries);
  for (const entry of entries) {
    entry.exposedToModel = entry.effectiveStatus === 'available';
  }

  return {
    snapshotId,
    runId: input.runId,
    projectId: input.projectId,
    permissionMode: input.permissionMode,
    modelId: input.modelId,
    createdAt: input.createdAt,
    registryVersion,
    sourceVersionHash: sourceVersionHash(input, registryVersion),
    sourceEntries,
    entries,
  };
}

export function listModelVisibleToolDefinitions(snapshot: ToolRegistrySnapshot): ToolDefinition[] {
  return snapshot.entries
    .filter((entry) => entry.exposedToModel)
    .map(modelVisibleDefinitionForSnapshotEntry);
}

export function resolveToolCallFromSnapshot(
  snapshot: ToolRegistrySnapshot,
  modelVisibleName: string,
): ToolCallSnapshotResolution {
  const matchingEntries = snapshot.entries.filter((entry) => entry.modelVisibleName === modelVisibleName);
  const availableEntry = matchingEntries.find((entry) =>
    entry.exposedToModel === true && entry.effectiveStatus === 'available',
  );

  if (availableEntry) {
    return {
      ok: true,
      entry: availableEntry,
      sourceIdentity: toolSourceIdentityForSnapshotEntry(snapshot, availableEntry),
      definition: modelVisibleDefinitionForSnapshotEntry(availableEntry),
    };
  }

  const entry = matchingEntries[0];
  if (!entry) {
    return {
      ok: false,
      reason: 'unknown_tool',
      message: `Unknown tool: ${modelVisibleName}`,
    };
  }

  const sourceIdentity = toolSourceIdentityForSnapshotEntry(snapshot, entry);
  if (entry.effectiveStatus === 'disabled') {
    return {
      ok: false,
      reason: 'tool_disabled',
      message: `Tool is disabled: ${modelVisibleName}${entry.disabledReason ? ` (${entry.disabledReason})` : ''}`,
      entry,
      sourceIdentity,
    };
  }
  if (entry.effectiveStatus === 'unavailable') {
    return {
      ok: false,
      reason: 'tool_unavailable',
      message: `Tool is unavailable: ${modelVisibleName}${entry.unavailableReason ? ` (${entry.unavailableReason})` : ''}`,
      entry,
      sourceIdentity,
    };
  }
  if (entry.effectiveStatus === 'conflicted') {
    return {
      ok: false,
      reason: 'tool_conflicted',
      message: `Tool is conflicted: ${modelVisibleName}${entry.conflictReason ? ` (${entry.conflictReason})` : ''}`,
      entry,
      sourceIdentity,
    };
  }

  return {
    ok: false,
    reason: 'tool_not_exposed',
    message: `Tool is not exposed to the model: ${modelVisibleName}`,
    entry,
    sourceIdentity,
  };
}

export function toolSourceIdentityForSnapshotEntry(
  snapshot: ToolRegistrySnapshot,
  entry: SnapshotToolEntry,
): ToolSourceIdentity {
  return {
    registrySnapshotId: snapshot.snapshotId,
    snapshotEntryId: entry.snapshotEntryId,
    modelVisibleName: entry.modelVisibleName,
    canonicalToolId: entry.canonicalToolId,
    sourceId: entry.sourceId,
    namespace: entry.namespace,
    sourceToolName: entry.sourceToolName,
  };
}

export function modelVisibleDefinitionForSnapshotEntry(entry: SnapshotToolEntry): ToolDefinition {
  return {
    ...cloneToolDefinition(entry.definition),
    name: entry.modelVisibleName,
    description: entry.definition.modelFacingDescription ?? entry.definition.description,
  };
}

export function getToolRegistrySnapshotResolutionTrace(
  snapshot: ToolRegistrySnapshot,
  input: { modelSupportsToolCall?: boolean } = {},
): ToolRegistrySnapshotResolutionTrace {
  const modelVisibleToolNames = snapshot.entries
    .filter((entry) => entry.exposedToModel)
    .map((entry) => entry.modelVisibleName);

  return {
    sourceIds: snapshot.sourceEntries.map((source) => source.sourceId),
    entryCount: snapshot.entries.length,
    exposedCount: modelVisibleToolNames.length,
    hiddenCount: snapshot.entries.length - modelVisibleToolNames.length,
    modelSupportsToolCall: input.modelSupportsToolCall ?? true,
    modelVisibleToolNames,
  };
}

function sourceEntryFor(source: ToolSource): ToolRegistrySnapshotSourceEntry {
  return {
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    namespace: source.namespace,
    displayName: source.displayName,
    configured: source.configured,
    enabled: source.enabled,
    availabilityStatus: source.availabilityStatus,
    ...(source.availabilityReason ? { availabilityReason: source.availabilityReason } : {}),
    ...(source.healthCheckedAt ? { healthCheckedAt: source.healthCheckedAt } : {}),
  };
}

function canonicalToolIdFor(registration: ToolRegistration): CanonicalToolId {
  return `${registration.sourceId}:${registration.namespace}:${registration.sourceToolName}` as CanonicalToolId;
}

function modelVisibleNameFor(registration: ToolRegistration) {
  const name = registration.sourceId === 'built_in' && registration.namespace === 'megumi'
    ? registration.sourceToolName
    : `${registration.namespace}_${registration.sourceToolName}`;
  return ToolNameSchema.parse(name);
}

function resolveEntryStatus(input: {
  registration: ToolRegistration;
  source?: ToolSource;
  modelSupportsToolCall: boolean;
}): Pick<SnapshotToolEntry, 'effectiveStatus' | 'disabledReason' | 'unavailableReason' | 'conflictReason'> {
  const { registration, source } = input;

  if (!source) {
    return { effectiveStatus: 'disabled', disabledReason: 'source_missing' };
  }
  if (source.configured === false) {
    return { effectiveStatus: 'disabled', disabledReason: 'source_not_configured' };
  }
  if (source.enabled === false) {
    return { effectiveStatus: 'disabled', disabledReason: 'source_disabled' };
  }
  if (registration.enabled === false) {
    return { effectiveStatus: 'disabled', disabledReason: 'tool_disabled' };
  }
  if (source.availabilityStatus !== 'available') {
    return {
      effectiveStatus: 'unavailable',
      unavailableReason: source.availabilityReason ?? 'source_unavailable',
    };
  }
  if (registration.availability.status === 'disabled') {
    return {
      effectiveStatus: 'disabled',
      disabledReason: registration.availability.reason ?? 'tool_disabled',
    };
  }
  if (registration.availability.status === 'unavailable') {
    return {
      effectiveStatus: 'unavailable',
      unavailableReason: registration.availability.reason ?? 'tool_unavailable',
    };
  }
  if (registration.definition.availability.status === 'disabled') {
    return {
      effectiveStatus: 'disabled',
      disabledReason: registration.definition.availability.reason ?? 'definition_disabled',
    };
  }
  if (registration.definition.availability.status === 'unavailable') {
    return {
      effectiveStatus: 'unavailable',
      unavailableReason: registration.definition.availability.reason ?? 'definition_unavailable',
    };
  }
  if (!input.modelSupportsToolCall) {
    return { effectiveStatus: 'disabled', disabledReason: 'model_tools_unsupported' };
  }
  return { effectiveStatus: 'available' };
}

function applyCanonicalConflicts(entries: SnapshotToolEntry[]): void {
  const byCanonicalId = groupEntriesBy(entries, (entry) => entry.canonicalToolId);
  for (const [canonicalToolId, groupedEntries] of byCanonicalId) {
    if (groupedEntries.length < 2) {
      continue;
    }
    for (const entry of groupedEntries) {
      markConflicted(entry, `Duplicate canonical tool identity: ${canonicalToolId}`);
    }
  }
}

function applyModelVisibleNameConflicts(entries: SnapshotToolEntry[]): void {
  const byModelVisibleName = groupEntriesBy(entries, (entry) => entry.modelVisibleName);
  for (const [modelVisibleName, groupedEntries] of byModelVisibleName) {
    if (groupedEntries.length < 2) {
      continue;
    }

    const builtInOwner = groupedEntries.find((entry) => entry.sourceId === 'built_in' && entry.namespace === 'megumi');
    for (const entry of groupedEntries) {
      if (builtInOwner && entry === builtInOwner) {
        continue;
      }
      markConflicted(entry, `Duplicate model visible tool name: ${modelVisibleName}`);
    }
  }
}

function markConflicted(entry: SnapshotToolEntry, conflictReason: string): void {
  entry.effectiveStatus = 'conflicted';
  delete entry.disabledReason;
  delete entry.unavailableReason;
  entry.conflictReason = conflictReason;
  entry.exposedToModel = false;
}

function groupEntriesBy<TKey extends string>(
  entries: SnapshotToolEntry[],
  keyFor: (entry: SnapshotToolEntry) => TKey,
): Map<TKey, SnapshotToolEntry[]> {
  const grouped = new Map<TKey, SnapshotToolEntry[]>();
  for (const entry of entries) {
    const key = keyFor(entry);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  return grouped;
}

function sourceVersionHash(input: ToolRegistrySnapshotResolutionInput, registryVersion: number): string {
  const sourceSegments = input.sources
    .map((source) => `${source.sourceId}:${source.enabled}:${source.availabilityStatus}:${source.updatedAt}`)
    .sort();
  const registrationSegments = input.registrations
    .map((registration) => `${registration.registrationId}:${registration.enabled}:${registration.availability.status}`)
    .sort();
  return [
    `registry-v${registryVersion}`,
    `sources:${sourceSegments.join(',')}`,
    `registrations:${registrationSegments.join(',')}`,
  ].join('|');
}

function safeIdSegment(value: string): string {
  return value.replaceAll(':', '-');
}
