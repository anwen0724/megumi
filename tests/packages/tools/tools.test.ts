import { describe, expect, it, vi } from 'vitest';
import { createTools, type BuiltInToolName } from '@megumi/tools';

describe('Tools ModelCall routing', () => {
  it('keeps one ModelCall view stable while a later ModelCall sees new availability', async () => {
    const disabled = new Set<BuiltInToolName>();
    const openSandbox = vi.fn(async () => ({ status: 'unavailable' as const, reason: 'Not used.' }));
    const tools = createTools({
      settings: {
        resolveWebSearch: () => ({ status: 'ok', settings: {} }),
        readWebSearchApiKey: () => ({ status: 'missing' }),
      },
      workspaces: {
        getWorkspace: ({ workspace_id }) => ({
          status: 'found',
          workspace: { root_path: `C:/workspace/${workspace_id}`, status: 'available' },
        }),
      },
      workspaceChanges: {
        trackToolExecution: ({ execute }) => execute(),
      },
      sandbox: {
        capabilities: () => ({
          platform: 'win32',
          workspaceEffectObservation: true,
          fileReadBoundary: true,
          fileWriteBoundary: true,
          environmentIsolation: true,
          networkIsolation: true,
          processTreeTermination: true,
          timeLimit: true,
          outputLimit: true,
          processCountLimit: true,
          cpuLimit: false,
          memoryLimit: false,
        }),
        open: openSandbox,
      },
      executionPolicy: {
        maxExecutionTimeMs: 1_000,
        maxOutputBytes: 20_000,
        maxProcessCount: 4,
      },
      builtInToolAvailability: {
        isAvailable: ({ toolName }) => !disabled.has(toolName),
      },
    });

    const first = tools.resolveModelCallTools({
      runId: 'run:1', sessionId: 'session:1', workspaceId: 'workspace:1', modelCallId: 'model-call:1',
    });
    expect(first.status).toBe('resolved');
    disabled.add('read_file');

    const routed = tools.routeToolCall({
      runId: 'run:1',
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      modelCallId: 'model-call:1',
      toolCallId: 'call:1',
      toolName: 'read_file',
      input: { path: 'notes.md' },
    });
    expect(routed.status).toBe('routed');
    if (routed.status !== 'routed') throw new Error('Expected routed read_file');
    await expect(tools.executeToolInvocation({
      invocation: structuredClone(routed.invocation),
    })).resolves.toMatchObject({
      type: 'failed', error: { code: 'sandbox_denied' },
    });
    expect(openSandbox).not.toHaveBeenCalled();
    expect(tools.listAvailableTools().tools.map((tool) => tool.registeredToolName))
      .not.toContain('read_file');

    const second = tools.resolveModelCallTools({
      runId: 'run:1', sessionId: 'session:1', workspaceId: 'workspace:1', modelCallId: 'model-call:2',
    });
    expect(second.status).toBe('resolved');
    if (second.status === 'resolved') {
      expect(second.definitions.map((tool) => tool.name))
        .not.toContain('read_file');
    }

    tools.releaseModelCallTools({ modelCallId: 'model-call:1' });
    expect(tools.routeToolCall({
      runId: 'run:1',
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      modelCallId: 'model-call:1',
      toolCallId: 'call:2',
      toolName: 'read_file',
      input: { path: 'notes.md' },
    })).toMatchObject({ status: 'failed', error: { code: 'unknown_tool' } });
  });

  it('executes update_plan without Permissions or Sandbox and emits a complete snapshot', async () => {
    const tools = createTools({
      settings: {
        resolveWebSearch: () => ({ status: 'failed' }),
        readWebSearchApiKey: () => ({ status: 'missing' }),
      },
      workspaces: {
        getWorkspace: () => ({ status: 'found', workspace: { root_path: 'C:/workspace', status: 'available' } }),
      },
      workspaceChanges: { trackToolExecution: ({ execute }) => execute() },
      sandbox: {
        capabilities: () => ({
          platform: 'win32', workspaceEffectObservation: true, fileReadBoundary: true,
          fileWriteBoundary: true, environmentIsolation: true, networkIsolation: true,
          processTreeTermination: true, timeLimit: true, outputLimit: true,
          processCountLimit: true, cpuLimit: false, memoryLimit: false,
        }),
        open: async () => ({ status: 'unavailable', reason: 'update_plan must not open Sandbox.' }),
      },
      executionPolicy: { maxExecutionTimeMs: 1_000, maxOutputBytes: 20_000, maxProcessCount: 4 },
      builtInToolAvailability: { isAvailable: () => true },
    });
    const scope = {
      runId: 'run:plan', sessionId: 'session:plan', workspaceId: 'workspace:plan', modelCallId: 'model-call:plan',
    };
    expect(tools.resolveModelCallTools(scope).status).toBe('resolved');
    const routed = tools.routeToolCall({
      ...scope,
      toolCallId: 'tool-call:plan',
      toolName: 'update_plan',
      input: { plan: [{ step: 'Implement', status: 'in_progress' }] },
    });
    expect(routed).toMatchObject({ status: 'routed', operations: [] });
    if (routed.status !== 'routed') throw new Error('Expected routed update_plan');
    const notifications: unknown[] = [];
    const result = await tools.executeToolInvocation(
      { invocation: routed.invocation },
      { onNotification: (notification) => notifications.push(notification) },
    );
    expect(result).toMatchObject({ type: 'succeeded', toolName: 'update_plan' });
    expect(notifications).toEqual([{
      type: 'plan_updated',
      plan: [{ step: 'Implement', status: 'in_progress' }],
    }]);
  });
});
