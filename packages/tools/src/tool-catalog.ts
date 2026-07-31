/* Owns validated, immutable Tool registration snapshots and model-visible lookup. */

import type {
  GetToolRequest,
  GetToolResult,
  ListToolsRequest,
  ListToolsResult,
  RegisteredTool,
  ToolDefinition,
  ToolRegistration,
} from './tool';

export interface ToolCatalog {
  list(request?: ListToolsRequest): ListToolsResult;
  get(request: GetToolRequest): GetToolResult;
}

export interface CreateToolCatalogRequest {
  readonly registrations: readonly ToolRegistration[];
}

export function createToolCatalog(request: CreateToolCatalogRequest): ToolCatalog {
  request.registrations.forEach(assertValidRegistration);
  const candidates = request.registrations.map(toCandidate);
  const duplicateIdentities = duplicateKeys(candidates, identityKey);
  const duplicateNames = duplicateKeys(candidates, (candidate) => candidate.tool.registeredToolName);
  const available = candidates
    .filter((candidate) => isAvailable(candidate.registration))
    .filter((candidate) => !duplicateIdentities.has(identityKey(candidate)))
    .filter((candidate) => !duplicateNames.has(candidate.tool.registeredToolName))
    .map((candidate) => deepFreeze(candidate.tool));
  const byName = new Map(available.map((tool) => [tool.registeredToolName, tool]));

  return {
    list(listRequest = {}) {
      return {
        tools: available
          .filter((tool) => !listRequest.sourceId || tool.source.sourceId === listRequest.sourceId)
          .map(cloneRegisteredTool),
      };
    },
    get(getRequest) {
      const tool = byName.get(getRequest.toolName);
      return tool
        ? { status: 'found', tool: cloneRegisteredTool(tool) }
        : { status: 'not_found', toolName: getRequest.toolName };
    },
  };
}

function assertValidRegistration(registration: ToolRegistration): void {
  if (!registration.registrationId.trim()) throw new TypeError('Tool registrationId must not be empty.');
  if (!registration.source.sourceId.trim()) throw new TypeError('Tool sourceId must not be empty.');
  if (!registration.source.namespace.trim()) throw new TypeError('Tool namespace must not be empty.');
  const definition = registration.definition;
  if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
    throw new TypeError(`Invalid Tool name: ${definition.name}`);
  }
  if (!definition.description.trim()) throw new TypeError(`Tool ${definition.name} requires a description.`);
  if (definition.inputSchema.type !== 'object') {
    throw new TypeError(`Tool ${definition.name} inputSchema must describe an object.`);
  }
  if (definition.capabilities.length === 0) {
    throw new TypeError(`Tool ${definition.name} requires at least one capability.`);
  }
}

function toCandidate(registration: ToolRegistration) {
  const registeredToolName = registration.source.sourceId === 'built_in'
    && registration.source.namespace === 'megumi'
    ? registration.definition.name
    : `${registration.source.namespace}_${registration.definition.name}`;
  const tool: RegisteredTool = {
    identity: {
      sourceId: registration.source.sourceId,
      namespace: registration.source.namespace,
      sourceToolName: registration.definition.name,
    },
    definition: cloneDefinition(registration.definition),
    registeredToolName,
    source: { ...registration.source },
    status: 'available',
  };
  return { registration, tool };
}

function isAvailable(registration: ToolRegistration): boolean {
  return registration.source.configured
    && registration.source.enabled
    && registration.source.availabilityStatus === 'available'
    && registration.enabled
    && registration.availability.status === 'available'
    && registration.definition.availability.status === 'available';
}

function identityKey(candidate: ReturnType<typeof toCandidate>): string {
  const identity = candidate.tool.identity;
  return `${identity.sourceId}:${identity.namespace}:${identity.sourceToolName}`;
}

function duplicateKeys<T>(items: readonly T[], keyFor: (item: T) => string): Set<string> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

function cloneRegisteredTool(tool: RegisteredTool): RegisteredTool {
  return JSON.parse(JSON.stringify(tool)) as RegisteredTool;
}

function cloneDefinition(definition: ToolDefinition): ToolDefinition {
  return JSON.parse(JSON.stringify(definition)) as ToolDefinition;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
