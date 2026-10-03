// @vitest-environment node
/*
 * Verifies authorization, cancellation and controlled effects through Agent's public run entry.
 */
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@megumi/ai';
import { writeFileTool, readFileTool, type AgentTool, type ApprovalDecision } from '@megumi/agent';
import { fixture, deferred } from './agent-fixture';

afterEach(() => vi.useRealTimers());

function externalTool(execute: AgentTool['execute']): AgentTool {
  return {
    name: 'invoke', description: 'Invoke an external operation', parameters: { type: 'object' },
    operations: () => [{ action: 'external.invoke', resource: { type: 'tool.identity', id: 'external' } }],
    execute,
  };
}

it('does not execute a tool requiring approval when no approval interaction is supplied', async () => {
  const { agent, config, provider } = fixture();
  let executed = false;
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall('invoke', {}), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Permission was denied.'),
  ]);
  const run = agent.startAgent({
    config: { ...config, tools: [externalTool(async () => {
      executed = true;
      return { outputKind: 'text', content: 'Invoked' };
    })] },
    input: { role: 'user', content: 'Invoke operation', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
  });
  const result = await run.completion;
  expect(executed).toBe(false);
  expect(result.runMessages.find(message => message.role === 'toolResult')).toMatchObject({ isError: true });
});

it('cancels approval waiting and ignores a late allow decision', async () => {
  const { agent, config, provider } = fixture();
  const waiting = deferred();
  let decide: (decision: ApprovalDecision) => void = () => {};
  const decision = new Promise<ApprovalDecision>(resolve => { decide = resolve; });
  let executed = false;
  provider.setResponses([fauxAssistantMessage(fauxToolCall('invoke', {}), { stopReason: 'toolUse' })]);
  const run = agent.startAgent({
    config: { ...config, tools: [externalTool(async () => {
      executed = true;
      return { outputKind: 'text', content: 'Invoked' };
    })] },
    input: { role: 'user', content: 'Invoke operation', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
    async awaitApproval() { waiting.resolve(); return decision; },
  });
  await waiting.promise;
  expect(run.snapshot().status).toBe('waiting');
  run.cancel();
  expect(await run.completion).toMatchObject({ status: 'cancelled' });
  decide({ status: 'allowed' });
  await decision;
  expect(executed).toBe(false);
});

it('excludes approval waiting from timeout and waits for an expired operation to stop', async () => {
  vi.useFakeTimers();
  const spans: string[] = [];
  const { agent, config, provider } = fixture({ diagnostics: {
    async observe(scope, operation) { spans.push(scope.name); return operation(); }, report() {},
  } });
  const waiting = deferred();
  const approved = deferred();
  const started = deferred();
  const stopped = deferred();
  let executionSignal: AbortSignal | undefined;
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall('invoke', {}), { stopReason: 'toolUse' }),
    fauxAssistantMessage('The operation timed out.'),
  ]);
  const run = agent.startAgent({
    config: { ...config, tools: [externalTool(async (_input, execution) => {
      executionSignal = execution.signal;
      started.resolve();
      await stopped.promise;
      return { outputKind: 'text', content: 'Already committed', metadata: { committed: true } };
    })] },
    input: { role: 'user', content: 'Invoke operation', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
    async awaitApproval() { waiting.resolve(); await approved.promise; return { status: 'allowed' }; },
  });
  await waiting.promise;
  expect(spans).toContain('permission.await');
  await vi.advanceTimersByTimeAsync(5_000);
  approved.resolve();
  await started.promise;
  expect(executionSignal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1_001);
  expect(executionSignal?.aborted).toBe(true);
  expect(run.snapshot().status).toBe('running');
  stopped.resolve();
  const result = await run.completion;
  expect(result.runMessages.find(message => message.role === 'toolResult')).toMatchObject({
    isError: true, details: { error: { code: 'tool_timeout' }, metadata: { committed: true } },
  });
});

it('writes and reads through the real file scope and retains the committed effect', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-agent-tools-'));
  try {
    const { agent, config, provider } = fixture();
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall('write_file', { path: 'note.txt', content: 'Remember the original value.' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('read_file', { path: 'note.txt' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('Saved and checked.'),
    ]);
    const result = await agent.startAgent({
      config: { ...config, permissionMode: 'full_access', tools: [writeFileTool, readFileTool],
        environment: { workingDirectory: directory, operatingSystem: 'Windows', shell: 'PowerShell' } },
      input: { role: 'user', content: 'Save a note', timestamp: 1 },
      context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
    }).completion;
    expect(result.status).toBe('completed');
    expect(await fs.readFile(path.join(directory, 'note.txt'), 'utf8')).toBe('Remember the original value.');
    expect(result.runMessages.find(message => message.role === 'toolResult' && message.toolName === 'write_file')).toMatchObject({
      isError: false, details: { effectReport: { coverage: 'complete', effects: [{ type: 'created', pathType: 'file' }] } },
    });
    expect(result.runMessages.find(message => message.role === 'toolResult' && message.toolName === 'read_file')).toMatchObject({ isError: false });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});


it('bounds parallel tools and waits for a serial barrier before starting later work', async () => {
  const { agent, config, provider } = fixture();
  const started = Array.from({ length: 4 }, () => deferred());
  const release = Array.from({ length: 4 }, () => deferred());
  const order: number[] = [];
  const tools = Array.from({ length: 4 }, (_, index): AgentTool => ({
    name: `task_${index}`, description: 'Task', parameters: { type: 'object' }, operations: () => [],
    executionMode: index === 2 ? 'serial' : 'parallel',
    async execute() { order.push(index); started[index].resolve(); await release[index].promise; return { outputKind: 'text', content: String(index) }; },
  }));
  provider.setResponses([fauxAssistantMessage(tools.map(tool => fauxToolCall(tool.name, {})), { stopReason: 'toolUse' }), fauxAssistantMessage('Done.')]);
  const run = agent.startAgent({ config: { ...config, tools }, input: { role: 'user', content: 'Tasks', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } } });
  try {
    await Promise.all([started[0].promise, started[1].promise]);
    expect(order).toEqual([0, 1]);
    release[1].resolve();
    expect(order).not.toContain(2);
    release[0].resolve();
    await started[2].promise;
    expect(order).toEqual([0, 1, 2]);
    release[2].resolve();
    await started[3].promise;
    release[3].resolve();
    expect(await run.completion).toMatchObject({ status: 'completed' });
  } finally { release.forEach(gate => gate.resolve()); await run.completion; }
});
