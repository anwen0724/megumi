// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssistantMessageEventStream, createTextBlock, createToolCallBlock, type AssistantMessage } from '../../../src/ai';
import { createLocalDesktopRuntime } from '../../../src/desktop';
import type { DesktopHostAdapters } from '../../../src/desktop/composition/create-host-adapters';
import { handleRecoveryOperation } from '../../../src/desktop/ipc/recovery.handler';
import { handleToolOperation } from '../../../src/desktop/ipc/tool.handler';
import { handleWorkspaceFilesOperation } from '../../../src/desktop/ipc/workspace-files.handler';
import { mapRendererApprovalToAppResume } from '../../../src/desktop/mappers/app-request.mapper';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-plan5-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'before', 'utf8');
  return root;
}

function fakeHosts(root: string): DesktopHostAdapters {
  return {
    clipboardHost: { readText: () => '', writeText: () => undefined },
    dialogHost: { openProjectDirectory: async () => root },
    environmentHost: { get: () => undefined },
    fileHost: { readFile: (filePath) => fs.readFile(filePath), writeFile: (filePath, data) => fs.writeFile(filePath, data) },
    megumiHomeHost: { getMegumiHome: () => path.join(root, '.megumi') },
    processHost: { spawn },
    secureStorageHost: { encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString('utf8'), isAvailable: () => true },
    shellHost: { openPath: async () => undefined },
  };
}

describe('desktop tools permission workspace productization', () => {
  it('lists tools, returns execution history, lists workspace changes, and restores a change set', async () => {
    const root = await tempRoot();
    const runtime = createLocalDesktopRuntime({
      hosts: fakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });

    const decision = runtime.permissionEvaluator.evaluate({
      decisionId: 'decision-1',
      mode: 'accept_edits',
      operation: 'write',
      actionName: 'write_file',
      target: 'src/a.ts',
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    await runtime.toolExecutionService.execute(
      { id: 'tool-call-1', name: 'write_file', input: { path: 'src/a.ts', content: 'after' } },
      { permissionDecision: decision, runId: 'run-1', sessionId: 'session-1', workspaceId: 'workspace-local', turnIndex: 0 },
    );

    await expect(handleToolOperation('tool.list', {}, { appApi: {} as never, hosts: fakeHosts(root), runtime, getMainWindow: () => undefined }))
      .resolves.toEqual({ tools: expect.arrayContaining([expect.objectContaining({ name: 'write_file' })]) });
    await expect(handleToolOperation('tool.execution.get', { toolCallId: 'tool-call-1' }, { appApi: {} as never, hosts: fakeHosts(root), runtime, getMainWindow: () => undefined }))
      .resolves.toEqual(expect.objectContaining({ execution: expect.objectContaining({ toolCallId: 'tool-call-1', status: 'succeeded' }) }));

    const changeSets = await handleWorkspaceFilesOperation('workspace.changes.list', { runId: 'run-1' }, { appApi: {} as never, hosts: fakeHosts(root), runtime, getMainWindow: () => undefined }) as { changeSets: Array<{ changeSetId: string }> };
    expect(changeSets.changeSets).toEqual([expect.objectContaining({ changeSetId: expect.any(String) })]);

    await expect(handleRecoveryOperation('recovery.restoreWorkspaceChangeSet', {
      changeSetId: changeSets.changeSets[0].changeSetId,
      requestedBy: 'user',
    }, { appApi: {} as never, hosts: fakeHosts(root), runtime, getMainWindow: () => undefined }))
      .resolves.toEqual(expect.objectContaining({ restore: expect.objectContaining({ status: 'completed', restoredCount: 1 }) }));
    await expect(fs.readFile(path.join(root, 'src/a.ts'), 'utf8')).resolves.toBe('before');
    await runtime.stop();
  });

  it('resumes with allow_for_session and reuses that permission for the same session target', async () => {
    const root = await tempRoot();
    const messages: AssistantMessage[] = [
      {
        role: 'assistant',
        content: [createToolCallBlock({
          id: 'tool-call-1',
          name: 'write_file',
          argumentsText: JSON.stringify({ path: 'src/a.ts', content: 'after first approval' }),
        })],
      },
      { role: 'assistant', content: [createTextBlock({ text: 'first done' })], stopReason: 'stop' },
      {
        role: 'assistant',
        content: [createToolCallBlock({
          id: 'tool-call-2',
          name: 'write_file',
          argumentsText: JSON.stringify({ path: 'src/a.ts', content: 'after reusable approval' }),
        })],
      },
      { role: 'assistant', content: [createTextBlock({ text: 'second done' })], stopReason: 'stop' },
    ];
    const runtime = createLocalDesktopRuntime({
      hosts: fakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
      ai: {
        stream() {
          const message = messages.shift();
          if (!message) throw new Error('unexpected AI stream request');
          return AssistantMessageEventStream.from([{ type: 'message_end', message }]);
        },
      },
    });
    const client = {
      clientKind: 'desktop' as const,
      requestId: 'request-1',
      createdAt: '2026-06-20T00:00:00.000Z',
      capabilities: { streaming: true, approval: true, filePicker: true, workspacePanel: true },
    };

    const first = await runtime.agentRuntime.startRun({
      rawInput: { id: 'input-1', text: 'write once', createdAt: '2026-06-20T00:00:00.000Z' },
      sessionId: 'session-1',
      workspaceId: 'workspace-local',
      permissionMode: 'default',
      client,
    });
    expect(first.status).toBe('waiting_for_approval');
    expect(first.waiting).toEqual(expect.objectContaining({ approvalRequestId: 'approval-tool-call-1' }));

    const resumeRequest = mapRendererApprovalToAppResume({
      runId: first.runId,
      sessionId: 'session-1',
      workspaceId: 'workspace-local',
      approvalRequestId: 'approval-tool-call-1',
      decision: 'approve',
      approvalScope: 'session',
    });
    expect(resumeRequest.decision).toBe('approve');
    expect(resumeRequest.metadata).toEqual(expect.objectContaining({ approvalScope: 'session' }));

    await expect(runtime.agentRuntime.resumeRun({ ...resumeRequest, client }))
      .resolves.toEqual(expect.objectContaining({ status: 'completed' }));
    await expect(runtime.permissionRepository.findReusablePermissionRecord({
      operation: 'write',
      target: 'src/a.ts',
      sessionId: 'session-1',
      now: '2026-06-20T00:00:00.000Z',
    })).resolves.toEqual(expect.objectContaining({ scope: 'session' }));

    await expect(runtime.agentRuntime.startRun({
      rawInput: { id: 'input-2', text: 'write again', createdAt: '2026-06-20T00:00:00.000Z' },
      sessionId: 'session-1',
      workspaceId: 'workspace-local',
      permissionMode: 'default',
      client: { ...client, requestId: 'request-2' },
    })).resolves.toEqual(expect.objectContaining({ status: 'completed' }));
    await expect(runtime.permissionRepository.getApprovalRequest('approval-tool-call-2')).resolves.toBeUndefined();
    await expect(fs.readFile(path.join(root, 'src/a.ts'), 'utf8')).resolves.toBe('after reusable approval');
    await runtime.stop();
  });
});
