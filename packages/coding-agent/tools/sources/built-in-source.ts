// Converts Megumi built-in tool definitions into source registrations consumed by the unified registry resolver.
import type { ToolDefinition, ToolRegistration } from '@megumi/shared/tool';
import { BUILT_IN_TOOL_DEFINITIONS } from '../built-ins';

export const BUILT_IN_TOOL_SOURCE_ID = 'built_in' as const;
export const BUILT_IN_TOOL_NAMESPACE = 'megumi' as const;

function cloneToolDefinition(definition: ToolDefinition): ToolDefinition {
  return JSON.parse(JSON.stringify(definition)) as ToolDefinition;
}

export function createBuiltInToolRegistrations(): ToolRegistration[] {
  return BUILT_IN_TOOL_DEFINITIONS.map((definition) => ({
    registrationId: `tool-registration-built_in-${definition.name}`,
    sourceId: BUILT_IN_TOOL_SOURCE_ID,
    namespace: BUILT_IN_TOOL_NAMESPACE,
    sourceToolName: definition.name,
    definition: cloneToolDefinition(definition),
    enabled: true,
    availability: definition.availability,
    executorBinding: { kind: 'built_in', bindingKey: definition.name },
    registrationMetadata: { registrationKind: 'built_in' },
  }));
}
