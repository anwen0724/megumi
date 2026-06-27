// @vitest-environment node
// PROOF that packages/coding-agent is a complete product runnable WITHOUT apps/desktop.
// Uses the fully composed product runtime against a real SQLite file and a real temp
// workspace, with NO desktop/electron import anywhere. Drives: create session ->
// advance run -> execute a real built-in tool (read_file over the real workspace) ->
// persist timeline history -> emit events -> survive a runtime "restart" (reopen the DB).
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeCodingAgentRuntime } from '@megumi/coding-agent/composition';
import { ProjectRepository, createDatabase, migrateDatabase } from '@megumi/coding-agent/persistence';
import {
  mergeRawAppSettings,
  resolveAppSettings,
  type AppSettingsRaw,
} from '@megumi/shared/settings';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream';
import type { ModelCallCompletionResult } from '@megumi/coding-agent/run';
import type { CodingAgentProductRuntime } from '@megumi/coding-agent/product-runtime';

function appSettingsProvider() {
  let rawSettings: AppSettingsRaw = {};
  return {
    getResolvedSettings: () => resolveAppSettings(rawSettings),
    updateSettings(patch: AppSettingsRaw) {
      rawSettings = mergeRawAppSettings(rawSettings, patch);
      return resolveAppSettings(rawSettings);
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

function seedProject(home: string, repoPath: string): string {
  const database = createDatabase(path.join(home, 'megumi.sqlite3'));
  try {
    migrateDatabase(database);
    return new ProjectRepository(database).upsertFromRepoPath({
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
  let runtime: CodingAgentProductRuntime | undefined;

  afterEach(async () => {
    runtime?.dispose();
    runtime = undefined;
    for (const dir of [home, workspace]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
    home = undefined;
    workspace = undefined;
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
      modelStepProviderService: toolCallingModelStepProvider('NOTES.md'),
      appSettingsProvider: appSettingsProvider(),
      memorySettingsProvider: { isMemoryEnabled: () => false },
      permissionSettingsProvider: { loadForProject: async () => ({ allow: [], ask: [], deny: [] }) },
      chatStreamEventSink: { publish: (event) => chatStreamEvents.push(event) },
    });

    // create session
    const session = runtime.sessionService.createSession({
      title: 'Proof session',
      workspaceId: projectId,
      workspacePath: workspace,
      createdAt: '2026-06-24T00:00:00.000Z',
    });

    // advance run (drives model step -> real tool execution -> terminal)
    const result = await runtime.agentRunService.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: String(session.sessionId),
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        context: { permissionMode: 'default' },
        messages: [{
          id: 'message-user-1',
          role: 'user',
          content: 'Create NOTES.md',
          createdAt: '2026-06-24T00:00:00.000Z',
        }],
        createdAt: '2026-06-24T00:00:00.000Z',
      },
    });

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

    // persists history: timeline rows committed
    const committed = runtime.sessionService.listTimelineMessagesBySession({
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
      modelStepProviderService: toolCallingModelStepProvider('UNUSED.md'),
      appSettingsProvider: appSettingsProvider(),
      memorySettingsProvider: { isMemoryEnabled: () => false },
      permissionSettingsProvider: { loadForProject: async () => ({ allow: [], ask: [], deny: [] }) },
    });

    const afterRestart = runtime.sessionService.listTimelineMessagesBySession({
      projectId,
      sessionId: String(session.sessionId),
    });
    expect(afterRestart.messages.length).toBe(committed.messages.length);
    expect(afterRestart.messages.some((message) => message.role === 'assistant')).toBe(true);

    const restartedSessions = runtime.sessionService.listSessions();
    expect(restartedSessions.some((s) => String(s.sessionId) === String(session.sessionId))).toBe(true);
  }, 30000);
});
