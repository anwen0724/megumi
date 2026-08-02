import { describe, expect, it } from 'vitest';
import { createToolRegistry, createToolRouter, type ToolRegistration } from '../../../packages/tools/src';

function registration(name: string): ToolRegistration {
  return {
    registrationId: `registration:${name}`,
    source: { sourceId: 'built_in', sourceKind: 'built_in', namespace: 'megumi', displayName: 'Built in', configured: true, enabled: true, availabilityStatus: 'available' },
    definition: { name, description: name, inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } },
    handler: { toolName: name, operations: () => [], async execute() { return { outputKind: 'text', content: name }; } },
    availability: { status: 'available' },
  };
}

describe('ModelCall ToolRouter', () => {
  it('routes only the selected ModelCall view and retains the original binding', () => {
    const registry = createToolRegistry({ registrations: [registration('first'), registration('second')] });
    const router = createToolRouter({
      scope: { runId: 'run:1', sessionId: 'session:1', workspaceId: 'workspace:1', modelCallId: 'model-call:1' },
      tools: [registry.get('first')!],
    });
    expect(router.definitions().map((tool) => tool.name)).toEqual(['first']);
    expect(router.route({ toolCallId: 'call:2', toolName: 'second', input: { value: 'x' } })).toMatchObject({ status: 'failed', error: { code: 'unknown_tool' } });
    expect(router.route({ toolCallId: 'call:1', toolName: 'first', input: {} })).toMatchObject({ status: 'failed', error: { code: 'invalid_tool_input' } });
    const routed = router.route({ toolCallId: 'call:1', toolName: 'first', input: { value: 'x' } });
    expect(routed.status).toBe('routed');
    if (routed.status === 'routed') {
      expect(Object.isFrozen(routed.invocation.input)).toBe(true);
      expect(Object.isFrozen(routed.operations)).toBe(true);
      expect(router.takeForExecution({
        ...routed.invocation,
        input: { value: 'replaced' },
      })).toBeUndefined();
      expect(router.takeForExecution(structuredClone(routed.invocation))?.registered.handler.toolName).toBe('first');
      expect(router.takeForExecution(routed.invocation)).toBeUndefined();
    }
  });
});
