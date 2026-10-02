/* Owns immutable system Tool registrations and rejects ambiguous bindings. */

import type { RegisteredTool, ToolRegistration } from './tool-handler';

export interface ToolRegistry<TContext = unknown> {
  list(): readonly RegisteredTool<TContext>[];
  get(toolName: string): RegisteredTool<TContext> | undefined;
}

export function createToolRegistry<TContext>(request: {
  readonly registrations: readonly ToolRegistration<TContext>[];
}): ToolRegistry<TContext> {
  const byName = new Map<string, RegisteredTool<TContext>>();
  const identities = new Set<string>();
  for (const registration of request.registrations) {
    const name = registration.definition.name;
    if (registration.handler.toolName !== name) {
      throw new Error(`Tool Definition and Handler names differ: ${name} != ${registration.handler.toolName}`);
    }
    if (byName.has(name)) throw new Error(`Duplicate registered Tool name: ${name}`);
    const identityKey = [registration.source.sourceId, registration.source.namespace, name].join(':');
    if (identities.has(identityKey)) throw new Error(`Duplicate Tool identity: ${identityKey}`);
    identities.add(identityKey);
    byName.set(name, Object.freeze({
      ...registration,
      identity: {
        sourceId: registration.source.sourceId,
        namespace: registration.source.namespace,
        sourceToolName: name,
      },
      registeredToolName: name,
      executionMode: registration.executionMode ?? 'parallel',
    }));
  }
  return { list: () => [...byName.values()], get: (toolName) => byName.get(toolName) };
}
