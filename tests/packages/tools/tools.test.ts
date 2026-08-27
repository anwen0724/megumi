import { describe, expect, it, vi } from 'vitest';
import { createTools, type BuiltInToolName } from '@megumi/tools';

describe('Tools ModelCall routing', () => {
  it('routes Candidate Supply search, read, and admission through its own Tool Group', async () => {
    const calls: string[] = [];
    const tools = createTools({
      settings: { resolveWebSearch: () => ({ status: 'failed' }), readWebSearchApiKey: () => ({ status: 'missing' }) },
      workspaces: { getWorkspace: () => { throw new Error('not used'); } },
      workspaceChanges: { trackToolExecution: ({ execute }) => execute() },
      sandbox: {
        capabilities: () => ({
          platform: 'win32', workspaceEffectObservation: true, fileReadBoundary: true,
          fileWriteBoundary: true, environmentIsolation: true, networkIsolation: true,
          processTreeTermination: true, timeLimit: true, outputLimit: true,
          processCountLimit: true, cpuLimit: false, memoryLimit: false,
        }),
        open: async () => ({ status: 'unavailable', reason: 'not used' }),
      },
      executionPolicy: { maxExecutionTimeMs: 1_000, maxOutputBytes: 20_000, maxProcessCount: 4 },
      candidateSupplyTools: {
        ownsExecution: (executionId) => executionId === 'execution:supply',
        async searchContent() { calls.push('search'); return { outputKind: 'json', content: { status: 'ok' } }; },
        async readSourceCandidate() { calls.push('read'); return { outputKind: 'json', content: { status: 'ok' } }; },
        async commitCandidateAdmission() { calls.push('commit'); return { outputKind: 'json', content: { status: 'ok' } }; },
      },
    });
    const execution = tools.bindExecution({
      executionId: 'execution:supply', subject: { kind: 'background' }, toolGroupId: 'candidate_supply',
    });
    expect(execution.status).toBe('bound');
    if (execution.status !== 'bound') return;
    const modelCall = execution.binding.prepareModelCall({ modelCallId: 'model-call:supply' });
    expect(modelCall.status).toBe('prepared');
    if (modelCall.status !== 'prepared') return;
    expect(modelCall.binding.definitions.map((definition) => definition.name)).toEqual([
      'search_content', 'read_source_candidate', 'commit_candidate_admission',
    ]);
    const invocations = [
      { toolName: 'search_content', input: { sourceId: 'open_web', query: 'Agent', mode: 'recent', limit: 10, targetInterestIds: [] } },
      { toolName: 'read_source_candidate', input: { candidateId: 'candidate:1' } },
      { toolName: 'commit_candidate_admission', input: { decisions: [{ candidateId: 'candidate:1', decision: 'needs_detail', reason: 'Need detail.' }] } },
    ];
    for (const { toolName, input } of invocations) {
      const routed = modelCall.binding.routeToolCall({ toolCallId: `call:${toolName}`, toolName, input });
      expect(routed.status).toBe('routed');
      if (routed.status === 'routed') await modelCall.binding.executeToolInvocation({ invocation: routed.invocation });
    }
    expect(calls).toEqual(['search', 'read', 'commit']);
  });

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

    const execution = tools.bindExecution({
      executionId: 'run:1',
      subject: { kind: 'session', sessionId: 'session:1', workspaceId: 'workspace:1' },
      toolGroupId: 'conversation',
    });
    expect(execution.status).toBe('bound');
    if (execution.status !== 'bound') throw new Error('Expected execution binding.');
    const first = execution.binding.prepareModelCall({ modelCallId: 'model-call:1' });
    expect(first.status).toBe('prepared');
    if (first.status !== 'prepared') throw new Error('Expected ModelCall binding.');
    disabled.add('read_file');

    const routed = first.binding.routeToolCall({
      toolCallId: 'call:1',
      toolName: 'read_file',
      input: { path: 'notes.md' },
    });
    expect(routed.status).toBe('routed');
    if (routed.status !== 'routed') throw new Error('Expected routed read_file');
    await expect(first.binding.executeToolInvocation({
      invocation: structuredClone(routed.invocation),
    })).resolves.toMatchObject({
      type: 'failed', error: { code: 'sandbox_denied' },
    });
    expect(openSandbox).not.toHaveBeenCalled();
    expect(tools.listAvailableTools().tools.map((tool) => tool.registeredToolName))
      .not.toContain('read_file');

    const second = execution.binding.prepareModelCall({ modelCallId: 'model-call:2' });
    expect(second.status).toBe('prepared');
    if (second.status === 'prepared') {
      expect(second.binding.definitions.map((tool) => tool.name))
        .not.toContain('read_file');
    }

    first.binding.close();
    expect(first.binding.routeToolCall({
      toolCallId: 'call:2',
      toolName: 'read_file',
      input: { path: 'notes.md' },
    })).toMatchObject({ status: 'failed', error: { code: 'unknown_tool' } });
    execution.binding.close();
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
    const execution = tools.bindExecution({
      executionId: 'run:plan',
      subject: { kind: 'session', sessionId: 'session:plan', workspaceId: 'workspace:plan' },
      toolGroupId: 'conversation',
    });
    if (execution.status !== 'bound') throw new Error('Expected execution binding.');
    const modelCall = execution.binding.prepareModelCall({ modelCallId: 'model-call:plan' });
    if (modelCall.status !== 'prepared') throw new Error('Expected ModelCall binding.');
    const routed = modelCall.binding.routeToolCall({
      toolCallId: 'tool-call:plan',
      toolName: 'update_plan',
      input: { plan: [{ step: 'Implement', status: 'in_progress' }] },
    });
    expect(routed).toMatchObject({ status: 'routed', operations: [] });
    if (routed.status !== 'routed') throw new Error('Expected routed update_plan');
    const notifications: unknown[] = [];
    const handlerResults: unknown[] = [];
    const result = await modelCall.binding.executeToolInvocation(
      { invocation: routed.invocation },
      {
        onNotification: (notification) => notifications.push(notification),
        onHandlerResult: (handlerResult) => handlerResults.push(handlerResult),
      },
    );
    expect(result).toMatchObject({ type: 'succeeded', toolName: 'update_plan' });
    expect(notifications).toEqual([{
      type: 'plan_updated',
      plan: [{ step: 'Implement', status: 'in_progress' }],
    }]);
    expect(handlerResults).toEqual([{
      outputKind: 'text',
      content: 'Plan updated',
    }]);
    execution.binding.close();
  });

});
