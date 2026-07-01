// Verifies the external host interface exposes only user-facing Coding Agent capabilities.
import { describe, expect, it } from 'vitest';
import { createCodingAgentHostInterface } from '@megumi/coding-agent/host-interface';

describe('CodingAgentHostInterface', () => {
  it('exposes only user-facing product capability groups to external hosts', () => {
    const host = createCodingAgentHostInterface({
      input: { send: async () => undefined as never, cancel: () => false },
      commands: {} as never,
      workspace: {} as never,
      session: {} as never,
      settings: {} as never,
      permissions: {} as never,
      artifacts: {} as never,
      dispose: () => undefined,
    });

    expect(host.input).toBeDefined();
    expect(host.commands).toBeDefined();
    expect(host.workspace).toBeDefined();
    expect(host.session).toBeDefined();
    expect(host.settings).toBeDefined();
    expect(host.permissions).toBeDefined();
    expect(host.artifacts).toBeDefined();
    expect(typeof host.dispose).toBe('function');
    expect(Object.keys(host).sort()).toEqual([
      'artifacts',
      'commands',
      'dispose',
      'input',
      'permissions',
      'session',
      'settings',
      'workspace',
    ]);
  });

  it('does not expose internal execution, tool, context, memory, state, or event modules', () => {
    const host = createCodingAgentHostInterface({
      input: { send: async () => undefined as never, cancel: () => false },
      commands: {} as never,
      workspace: {} as never,
      session: {} as never,
      settings: {} as never,
      permissions: {} as never,
      artifacts: {} as never,
      dispose: () => undefined,
    }) as unknown as Record<string, unknown>;

    expect(host.tools).toBeUndefined();
    expect(host.context).toBeUndefined();
    expect(host.contextInspection).toBeUndefined();
    expect(host.execution).toBeUndefined();
    expect(host.eventLog).toBeUndefined();
    expect(host.recovery).toBeUndefined();
    expect(host.memory).toBeUndefined();
    expect(host.agentLoop).toBeUndefined();
    expect(host.state).toBeUndefined();
    expect(host.events).toBeUndefined();
  });
});
