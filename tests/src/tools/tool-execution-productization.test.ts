import { describe, expect, it } from 'vitest';
import { evaluatePermissionPolicy } from '../../../src/permission';
import {
  createBuiltInToolRegistry,
  createInMemoryToolExecutionRepository,
  createToolExecutionService,
  createToolRegistry,
  type ToolDefinition,
} from '../../../src/tools';
import {
  createInMemoryWorkspaceRepository,
  createWorkspace,
  createWorkspaceManager,
  type WorkspaceFileHost,
  type WorkspacePath,
} from '../../../src/workspace';

function memoryHost(files: Record<string, string>): WorkspaceFileHost {
  return {
    async readTextFile(path) { return files[String(path)] ?? ''; },
    async writeTextFile(path, content) { files[String(path)] = content; },
    async deleteFile(path) { delete files[String(path)]; },
    async fileExists(path) { return Object.prototype.hasOwnProperty.call(files, String(path)); },
    async listDirectory() { return Object.keys(files).map((file) => ({ name: file, path: file as WorkspacePath, kind: 'file' as const })); },
  };
}

describe('ToolExecutionService productization', () => {
  it('persists execution, audit, and workspace change facts for mutation tools', async () => {
    const files = { 'src/a.ts': 'before' };
    const workspaceRepository = createInMemoryWorkspaceRepository();
    const workspace = createWorkspace({ id: 'workspace-local', projectRoot: 'C:/repo', createdAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-20T00:00:00.000Z' });
    const workspaceManager = createWorkspaceManager({
      workspace,
      fileHost: memoryHost(files),
      repository: workspaceRepository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const executionRepository = createInMemoryToolExecutionRepository();
    const service = createToolExecutionService({
      registry: createBuiltInToolRegistry(),
      workspace: workspaceManager,
      executionRepository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const decision = evaluatePermissionPolicy({
      decisionId: 'decision-1',
      mode: 'accept_edits',
      operation: 'write',
      actionName: 'write_file',
      target: 'src/a.ts',
      createdAt: '2026-06-20T00:00:00.000Z',
    });

    const result = await service.execute(
      { id: 'tool-call-1', name: 'write_file', input: { path: 'src/a.ts', content: 'after' } },
      {
        permissionDecision: decision,
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-local',
        turnIndex: 0,
      },
    );

    expect(result.status).toBe('success');
    await expect(executionRepository.listExecutions({ runId: 'run-1' })).resolves.toEqual([
      expect.objectContaining({
        toolCallId: 'tool-call-1',
        status: 'succeeded',
        workspaceChangeSetId: expect.any(String),
      }),
    ]);
    await expect(workspaceRepository.listChangeSets({ runId: 'run-1' })).resolves.toEqual([
      expect.objectContaining({
        toolCallId: 'tool-call-1',
        changes: [expect.objectContaining({ path: 'src/a.ts', operation: 'write' })],
      }),
    ]);
    await expect(executionRepository.listAuditRecords({ toolCallId: 'tool-call-1' })).resolves.toHaveLength(1);
  });

  it('appends audit facts for repeated records under one tool call', async () => {
    const files = { 'src/a.ts': 'before' };
    const workspaceRepository = createInMemoryWorkspaceRepository();
    const workspace = createWorkspace({ id: 'workspace-local', projectRoot: 'C:/repo', createdAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-20T00:00:00.000Z' });
    const workspaceManager = createWorkspaceManager({
      workspace,
      fileHost: memoryHost(files),
      repository: workspaceRepository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const executionRepository = createInMemoryToolExecutionRepository();
    const service = createToolExecutionService({
      registry: createBuiltInToolRegistry(),
      workspace: workspaceManager,
      executionRepository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const ask = evaluatePermissionPolicy({
      decisionId: 'decision-1',
      mode: 'default',
      operation: 'write',
      actionName: 'write_file',
      target: 'src/a.ts',
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    const allow = evaluatePermissionPolicy({
      decisionId: 'decision-2',
      mode: 'accept_edits',
      operation: 'write',
      actionName: 'write_file',
      target: 'src/a.ts',
      createdAt: '2026-06-20T00:00:01.000Z',
    });

    await service.execute(
      { id: 'tool-call-1', name: 'write_file', input: { path: 'src/a.ts', content: 'after' } },
      { permissionDecision: ask, runId: 'run-1', sessionId: 'session-1', workspaceId: 'workspace-local', turnIndex: 0, approvalRequestId: 'approval-1' },
    );
    await service.execute(
      { id: 'tool-call-1', name: 'write_file', input: { path: 'src/a.ts', content: 'after' } },
      { permissionDecision: allow, runId: 'run-1', sessionId: 'session-1', workspaceId: 'workspace-local', turnIndex: 0 },
    );

    const auditRecords = await executionRepository.listAuditRecords({ toolCallId: 'tool-call-1' });
    expect(auditRecords.map((record) => record.status)).toEqual(['awaiting_approval', 'success']);
    expect(new Set(auditRecords.map((record) => record.id)).size).toBe(2);
  });

  it('maps error tool results to failed executions', async () => {
    const definition: ToolDefinition = {
      name: 'return_error',
      description: 'Returns an error result.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      source: { kind: 'builtin', id: 'return_error' },
      sideEffect: 'read',
      execution: { executionMode: 'serial', mutation: 'read_only', requiresPermission: false, supportsCancellation: false },
      permission: { operation: 'read' },
    };
    const registry = createToolRegistry({
      tools: [definition],
      executors: new Map([[
        'return_error',
        {
          async execute(call) {
            return {
              status: 'error',
              toolCallId: call.id,
              toolName: call.name,
              error: { code: 'EXPECTED_ERROR', message: 'expected failure', retryable: false },
            };
          },
        },
      ]]),
    });
    const workspace = createWorkspace({ id: 'workspace-local', projectRoot: 'C:/repo', createdAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-20T00:00:00.000Z' });
    const workspaceManager = createWorkspaceManager({
      workspace,
      fileHost: memoryHost({}),
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const executionRepository = createInMemoryToolExecutionRepository();
    const service = createToolExecutionService({
      registry,
      workspace: workspaceManager,
      executionRepository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });

    await service.execute(
      { id: 'tool-call-1', name: 'return_error', input: {} },
      {
        permissionDecision: evaluatePermissionPolicy({
          decisionId: 'decision-1',
          mode: 'accept_edits',
          operation: 'read',
          actionName: 'return_error',
          target: 'src/a.ts',
          createdAt: '2026-06-20T00:00:00.000Z',
        }),
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-local',
        turnIndex: 0,
      },
    );

    await expect(executionRepository.getExecution('tool-execution-tool-call-1')).resolves.toEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('finalizes mutation workspace changes when the executor throws after writing', async () => {
    const definition: ToolDefinition = {
      name: 'write_then_throw',
      description: 'Writes a file and then throws.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      source: { kind: 'builtin', id: 'write_then_throw' },
      sideEffect: 'write',
      execution: { executionMode: 'serial', mutation: 'mutation', requiresPermission: false, supportsCancellation: false },
      permission: { operation: 'write' },
    };
    const registry = createToolRegistry({
      tools: [definition],
      executors: new Map([[
        'write_then_throw',
        {
          async execute(_call, context) {
            await context.workspace.writeFile({ path: 'src/a.ts', content: 'after' });
            throw new Error('write failed after mutation');
          },
        },
      ]]),
    });
    const files = { 'src/a.ts': 'before' };
    const workspaceRepository = createInMemoryWorkspaceRepository();
    const workspace = createWorkspace({ id: 'workspace-local', projectRoot: 'C:/repo', createdAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-20T00:00:00.000Z' });
    const workspaceManager = createWorkspaceManager({
      workspace,
      fileHost: memoryHost(files),
      repository: workspaceRepository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const executionRepository = createInMemoryToolExecutionRepository();
    const service = createToolExecutionService({
      registry,
      workspace: workspaceManager,
      executionRepository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });

    await service.execute(
      { id: 'tool-call-1', name: 'write_then_throw', input: {} },
      {
        permissionDecision: evaluatePermissionPolicy({
          decisionId: 'decision-1',
          mode: 'accept_edits',
          operation: 'write',
          actionName: 'write_then_throw',
          target: 'src/a.ts',
          createdAt: '2026-06-20T00:00:00.000Z',
        }),
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-local',
        turnIndex: 0,
      },
    );

    await expect(executionRepository.getExecution('tool-execution-tool-call-1')).resolves.toEqual(expect.objectContaining({
      status: 'failed',
      workspaceChangeSetId: expect.any(String),
    }));
    await expect(workspaceRepository.listChangeSets({ runId: 'run-1' })).resolves.toEqual([
      expect.objectContaining({
        toolCallId: 'tool-call-1',
        changes: [expect.objectContaining({ path: 'src/a.ts', operation: 'write' })],
      }),
    ]);
  });
});
