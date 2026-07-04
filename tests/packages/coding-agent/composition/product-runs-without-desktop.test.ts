// @vitest-environment node
// PROOF that packages/coding-agent is a complete product runnable WITHOUT apps/desktop.
// Uses the fully composed host interface against a real SQLite file and a real temp
// workspace, with NO desktop/electron import anywhere. Drives: create session ->
// advance run -> execute a real built-in tool (read_file over the real workspace) ->
// persist timeline history -> emit events -> survive a runtime "restart" (reopen the DB).
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeCodingAgentPersistence } from '@megumi/coding-agent/composition/compose-coding-agent-persistence';
import { composeCodingAgentRuntime } from '@megumi/coding-agent/composition';
import { WorkspaceRepository, createDatabase } from '@megumi/coding-agent/persistence';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import type { SettingsRaw } from '@megumi/coding-agent/settings';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream';
import type { ModelCallCompletionResult } from '@megumi/coding-agent/agent-loop/model-call';
import type { CodingAgentHostInterface } from '@megumi/coding-agent/host-interface';

function productSettingsStorage(initial: SettingsRaw = {}) {
  let rawSettings: SettingsRaw = initial;
  return {
    readRawSettings: () => rawSettings,
    writeRawSettings(next: SettingsRaw) {
      rawSettings = next;
    },
  };
}

// A model step provider that asks the product to run the real built-in read_file
// tool (auto-allowed for project reads), then emits a final assistant answer once
// the tool result feeds back.
function toolCallingModelStepProvider(targetFileName: string) {
  let call = 0;
  return {
    async *streamModelCall(request: { sessionId: string; runId: string; stepId: string }): AsyncIterable<RuntimeEvent> {
      call += 1;
      if (call === 1) {
        yield {
          eventId: 'event-tool-call-1',
          schemaVersion: 1,
          eventType: 'tool.call.created',
          sessionId: request.sessionId,
          runId: request.runId,
          stepId: request.stepId,
          sequence: 1,
          createdAt: '2026-06-24T00:00:01.000Z',
          source: 'provider',
          visibility: 'system',
          persist: 'required',
          payload: {
            toolCallId: 'tool-call-1',
            modelStepId: 'model-step-1',
            providerToolCallId: 'provider-tool-call-1',
            toolName: 'read_file',
            input: { path: targetFileName },
          },
        } as RuntimeEvent;
        yield {
          eventId: 'event-model-step-completed-1',
          schemaVersion: 1,
          eventType: 'model.step.completed',
          sessionId: request.sessionId,
          runId: request.runId,
          stepId: request.stepId,
          sequence: 2,
          createdAt: '2026-06-24T00:00:02.000Z',
          source: 'provider',
          visibility: 'system',
          persist: 'required',
          payload: { modelStepId: 'model-step-1', finishReason: 'tool_calls' },
        } as RuntimeEvent;
        return;
      }
      yield {
        eventId: 'event-assistant-completed',
        schemaVersion: 1,
        eventType: 'assistant.output.completed',
        sessionId: request.sessionId,
        runId: request.runId,
        stepId: request.stepId,
        sequence: 1,
        createdAt: '2026-06-24T00:00:03.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: { content: 'Read the file as requested.' },
      } as RuntimeEvent;
    },
    completeModelCall: async (): Promise<ModelCallCompletionResult> => ({ ok: true, text: '' }),
    cancelModelCall: () => false,
  };
}

function singleToolCallingModelStepProvider(toolName: string, input: unknown) {
  let call = 0;
  return {
    async *streamModelCall(request: { sessionId: string; runId: string; stepId: string }): AsyncIterable<RuntimeEvent> {
      call += 1;
      if (call === 1) {
        yield {
          eventId: `event-tool-call-${toolName}`,
          schemaVersion: 1,
          eventType: 'tool.call.created',
          sessionId: request.sessionId,
          runId: request.runId,
          stepId: request.stepId,
          sequence: 1,
          createdAt: '2026-06-24T00:00:01.000Z',
          source: 'provider',
          visibility: 'system',
          persist: 'required',
          payload: {
            toolCallId: `tool-call-${toolName}`,
            modelStepId: `model-step-${toolName}`,
            providerToolCallId: `provider-tool-call-${toolName}`,
            toolName,
            input,
          },
        } as RuntimeEvent;
        yield {
          eventId: `event-model-step-completed-${toolName}`,
          schemaVersion: 1,
          eventType: 'model.step.completed',
          sessionId: request.sessionId,
          runId: request.runId,
          stepId: request.stepId,
          sequence: 2,
          createdAt: '2026-06-24T00:00:02.000Z',
          source: 'provider',
          visibility: 'system',
          persist: 'required',
          payload: { modelStepId: `model-step-${toolName}`, finishReason: 'tool_calls' },
        } as RuntimeEvent;
        return;
      }
      yield {
        eventId: `event-assistant-completed-${toolName}`,
        schemaVersion: 1,
        eventType: 'assistant.output.completed',
        sessionId: request.sessionId,
        runId: request.runId,
        stepId: request.stepId,
        sequence: 1,
        createdAt: '2026-06-24T00:00:03.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: { content: `${toolName} finished.` },
      } as RuntimeEvent;
    },
    completeModelCall: async (): Promise<ModelCallCompletionResult> => ({ ok: true, text: '' }),
    cancelModelCall: () => false,
  };
}

function seedProject(home: string, repoPath: string): string {
  const database = createDatabase(path.join(home, 'megumi.sqlite3'));
  try {
    applyCodingAgentDatabaseMigrations(database);
    return new WorkspaceRepository(database).upsertFromRepoPath({
      repoPath,
      now: '2026-06-24T00:00:00.000Z',
    }).projectId;
  } finally {
    database.close();
  }
}

describe('coding-agent product runs without desktop', () => {
  let home: string | undefined;
  let workspace: string | undefined;
  let runtime: CodingAgentHostInterface | undefined;

  afterEach(async () => {
    runtime?.dispose();
    runtime = undefined;
    for (const dir of [home, workspace]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
    home = undefined;
    workspace = undefined;
  });

  it('composes only the aggregate persistence repositories', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'megumi-persistence-shape-'));

    const persistence = composeCodingAgentPersistence({ sqlitePath: home });
    try {
      expect(Object.keys(persistence).sort()).toEqual([
        'agentLoopRepository',
        'artifactRepository',
        'database',
        'memoryRepository',
        'sessionRepository',
        'toolCallRepository',
        'workspaceChangeRepository',
        'workspaceRepository',
      ].sort());

      expect(persistence).not.toHaveProperty('runRecordRepository');
      expect(persistence).not.toHaveProperty('modelStepRepository');
      expect(persistence).not.toHaveProperty('runtimeEventRepository');
      expect(persistence).not.toHaveProperty('activePathRepository');
      expect(persistence).not.toHaveProperty('timelineMessageRepository');
      expect(persistence).not.toHaveProperty('permissionSnapshotRepository');
      expect(persistence).not.toHaveProperty('projectRepository');
      expect(persistence).not.toHaveProperty('toolRepository');
    } finally {
      persistence.database.close();
    }
  });

  it('creates a session, advances a run, executes a real tool, persists history, and survives restart', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'megumi-proof-home-'));
    workspace = await mkdtemp(path.join(os.tmpdir(), 'megumi-proof-ws-'));
    // Real file in the real workspace for the real read_file tool to read.
    await writeFile(path.join(workspace, 'NOTES.md'), 'hello from the workspace', 'utf8');
    const projectId = seedProject(home, workspace);
    const chatStreamEvents: ChatStreamEvent[] = [];

    runtime = composeCodingAgentRuntime({
      homePaths: { homePath: home, sqlitePath: home, settingsPath: path.join(home, 'settings.json') },
      runtimeLogger: { warn: () => undefined },
      modelCallProviderService: toolCallingModelStepProvider('NOTES.md'),
      settingsStorage: productSettingsStorage(),
      chatStreamEventSink: { publish: (event) => chatStreamEvents.push(event) },
    });

    expect(runtime.settings.get().settings.memory.enabled).toBe(false);
    runtime.settings.update({ memory: { enabled: true } });
    expect(runtime.settings.get().settings.memory).toEqual({ enabled: true });

    // submit product input (drives session creation -> model step -> real tool
    // execution -> terminal) through the shell-agnostic host interface entry.
    const result = await runtime.input.send({
      requestId: 'request-1',
      sessionTitle: 'Proof session',
      workspaceId: projectId,
      workspacePath: workspace,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      text: 'Create NOTES.md',
      permissionMode: 'default',
      createdAt: '2026-06-24T00:00:00.000Z',
    });
    if (result.type !== 'agent_run') {
      throw new Error(`Expected agent_run result, got ${result.type}`);
    }
    const session = result.session;

    const runtimeEventTypes: string[] = [];
    for await (const event of result.events) {
      runtimeEventTypes.push((event as RuntimeEvent).eventType);
    }

    // outputs events: run reaches a terminal completed state
    expect(runtimeEventTypes).toContain('run.completed');
    expect(chatStreamEvents.some((event) => event.eventType === 'turn.completed')).toBe(true);

    // executes tool: the run advanced THROUGH a real built-in tool execution
    // (read_file) to completion — proven by the tool lifecycle events and the
    // terminal completed state above. The real workspace file it read is intact.
    const targetPath = path.join(workspace, 'NOTES.md');
    await expect(stat(targetPath)).resolves.toBeTruthy();
    expect(await readFile(targetPath, 'utf8')).toBe('hello from the workspace');
    expect(runtimeEventTypes).toContain('tool.call.created');
    expect(runtimeEventTypes.some((type) => type.startsWith('tool.execution.'))).toBe(true);
    expect(workspaceChangeRows(home)).toEqual([]);

    // persists history: timeline rows committed
    const committed = runtime.session.listTimeline({
      projectId,
      sessionId: String(session.sessionId),
    });
    expect(committed.messages.length).toBeGreaterThan(0);

    // survives restart: dispose, reopen a fresh runtime on the same SQLite file,
    // history is still readable (no desktop involved at any point)
    runtime.dispose();
    runtime = composeCodingAgentRuntime({
      homePaths: { homePath: home, sqlitePath: home, settingsPath: path.join(home, 'settings.json') },
      runtimeLogger: { warn: () => undefined },
      modelCallProviderService: toolCallingModelStepProvider('UNUSED.md'),
      settingsStorage: productSettingsStorage(),
    });

    const afterRestart = runtime.session.listTimeline({
      projectId,
      sessionId: String(session.sessionId),
    });
    expect(afterRestart.messages.length).toBe(committed.messages.length);
    expect(afterRestart.messages.some((message) => message.role === 'assistant')).toBe(true);

    const restartedSessions = runtime.session.list().sessions;
    expect(restartedSessions.some((s) => String(s.sessionId) === String(session.sessionId))).toBe(true);
  }, 30000);

  it('records successful managed workspace mutations through the composed tool runtime', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'megumi-proof-home-'));
    workspace = await mkdtemp(path.join(os.tmpdir(), 'megumi-proof-ws-'));
    const projectId = seedProject(home, workspace);

    runtime = composeCodingAgentRuntime({
      homePaths: { homePath: home, sqlitePath: home, settingsPath: path.join(home, 'settings.json') },
      runtimeLogger: { warn: () => undefined },
      modelCallProviderService: singleToolCallingModelStepProvider('write_file', {
        path: 'CREATED.md',
        content: 'created through tool runtime',
        overwrite: false,
      }),
      settingsStorage: productSettingsStorage(),
    });

    const result = await runtime.input.send({
      requestId: 'request-write',
      sessionTitle: 'Write session',
      workspaceId: projectId,
      workspacePath: workspace,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      text: 'Write CREATED.md',
      permissionMode: 'accept_edits',
      createdAt: '2026-06-24T00:00:00.000Z',
    });
    if (result.type !== 'agent_run') {
      throw new Error(`Expected agent_run result, got ${result.type}`);
    }

    const runtimeEventTypes: string[] = [];
    for await (const event of result.events) {
      runtimeEventTypes.push((event as RuntimeEvent).eventType);
    }

    expect(runtimeEventTypes).toContain('run.completed');
    await expect(readFile(path.join(workspace, 'CREATED.md'), 'utf8')).resolves.toBe('created through tool runtime');
    expect(workspaceChangeRows(home)).toEqual([
      { status: 'open', workspace_path: 'CREATED.md', change_kind: 'created' },
    ]);
  }, 30000);

  it('does not record changed files when a managed workspace mutation tool fails', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'megumi-proof-home-'));
    workspace = await mkdtemp(path.join(os.tmpdir(), 'megumi-proof-ws-'));
    const projectId = seedProject(home, workspace);

    runtime = composeCodingAgentRuntime({
      homePaths: { homePath: home, sqlitePath: home, settingsPath: path.join(home, 'settings.json') },
      runtimeLogger: { warn: () => undefined },
      modelCallProviderService: singleToolCallingModelStepProvider('write_file', { path: 'BROKEN.md' }),
      settingsStorage: productSettingsStorage(),
    });

    const result = await runtime.input.send({
      requestId: 'request-failed-write',
      sessionTitle: 'Failed write session',
      workspaceId: projectId,
      workspacePath: workspace,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      text: 'Try to write BROKEN.md',
      permissionMode: 'accept_edits',
      createdAt: '2026-06-24T00:00:00.000Z',
    });
    if (result.type !== 'agent_run') {
      throw new Error(`Expected agent_run result, got ${result.type}`);
    }

    for await (const _event of result.events) {
      // Drain the composed runtime stream.
    }

    await expect(stat(path.join(workspace, 'BROKEN.md'))).rejects.toThrow();
    expect(workspaceChangeRows(home)).toEqual([]);
  }, 30000);

});

function workspaceChangeRows(homePath: string): Array<{ status: string; workspace_path: string; change_kind: string }> {
  const database = createDatabase(path.join(homePath, 'megumi.sqlite3'));
  try {
    return database.prepare(`
      SELECT wc.status, wcf.workspace_path, wcf.change_kind
      FROM workspace_changes wc
      INNER JOIN workspace_changed_files wcf ON wcf.change_set_id = wc.change_set_id
      ORDER BY wcf.created_at ASC
    `).all() as Array<{ status: string; workspace_path: string; change_kind: string }>;
  } finally {
    database.close();
  }
}

