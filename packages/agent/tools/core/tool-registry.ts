// Builds the internal tool registry and resolves available registered tools.
import type {
  RegisteredTool,
  ToolDefinition,
  ToolRegistration,
  ToolSource,
} from '../contracts/tool-contracts';
import { listBuiltInToolDefinitions, type BuiltInToolName } from './tool-definitions';

export const BUILT_IN_TOOL_SOURCE: ToolSource = {
  sourceId: 'built_in',
  sourceKind: 'built_in',
  namespace: 'megumi',
  displayName: 'Built-in tools',
  configured: true,
  enabled: true,
  availabilityStatus: 'available',
};

export type ToolRegistry = {
  listAvailableTools(): RegisteredTool[];
  getRegisteredTool(toolName: string): RegisteredTool | undefined;
};

export function createBuiltInToolRegistrations(input: {
  disabledToolNames?: readonly BuiltInToolName[];
} = {}): ToolRegistration[] {
  const disabledToolNames = new Set<string>(input.disabledToolNames ?? []);
  return listBuiltInToolDefinitions().map((definition) => {
    const enabled = !disabledToolNames.has(definition.name);
    return {
      registrationId: `tool-registration-built_in-${definition.name}`,
      source: { ...BUILT_IN_TOOL_SOURCE },
      definition,
      enabled,
      availability: enabled
        ? definition.availability
        : { status: 'disabled', reason: 'Required runtime capability is not configured.' },
    };
  });
}

export function createToolRegistry(input: {
  registrations?: ToolRegistration[];
} = {}): ToolRegistry {
  const registrations = input.registrations ?? createBuiltInToolRegistrations();
  const entries = registrations.map(toRegisteredToolCandidate);
  const conflictedIdentityKeys = duplicateKeys(entries, identityKey);
  const conflictedRegisteredNames = duplicateKeys(entries, (entry) => entry.registeredToolName);
  const availableTools = entries.filter((entry) => (
    isAvailableRegistration(entry.registration)
    && !conflictedIdentityKeys.has(identityKey(entry))
    && !conflictedRegisteredNames.has(entry.registeredToolName)
  )).map((entry) => cloneRegisteredTool(entry.tool));
  const byName = new Map(availableTools.map((tool) => [tool.registeredToolName, tool]));

  return {
    listAvailableTools() {
      return availableTools.map(cloneRegisteredTool);
    },
    getRegisteredTool(toolName) {
      const tool = byName.get(toolName);
      return tool ? cloneRegisteredTool(tool) : undefined;
    },
  };
}

function toRegisteredToolCandidate(registration: ToolRegistration) {
  const registeredToolName = registeredToolNameFor(registration);
  const sourceToolName = registration.definition.name;
  const tool: RegisteredTool = {
    identity: {
      sourceId: registration.source.sourceId,
      namespace: registration.source.namespace,
      sourceToolName,
    },
    definition: cloneToolDefinition(registration.definition),
    registeredToolName,
    source: { ...registration.source },
    status: 'available',
  };
  return { registration, registeredToolName, tool };
}

function registeredToolNameFor(registration: ToolRegistration): string {
  if (registration.source.sourceId === 'built_in' && registration.source.namespace === 'megumi') {
    return registration.definition.name;
  }
  return `${registration.source.namespace}_${registration.definition.name}`;
}

function isAvailableRegistration(registration: ToolRegistration): boolean {
  return registration.source.configured
    && registration.source.enabled
    && registration.source.availabilityStatus === 'available'
    && registration.enabled
    && registration.availability.status === 'available'
    && registration.definition.availability.status === 'available';
}

function identityKey(entry: ReturnType<typeof toRegisteredToolCandidate>): string {
  const { identity } = entry.tool;
  return `${identity.sourceId}:${identity.namespace}:${identity.sourceToolName}`;
}

function duplicateKeys<T>(items: T[], keyFor: (item: T) => string): Set<string> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function cloneRegisteredTool(tool: RegisteredTool): RegisteredTool {
  return JSON.parse(JSON.stringify(tool)) as RegisteredTool;
}

function cloneToolDefinition(definition: ToolDefinition): ToolDefinition {
  return JSON.parse(JSON.stringify(definition)) as ToolDefinition;
}
