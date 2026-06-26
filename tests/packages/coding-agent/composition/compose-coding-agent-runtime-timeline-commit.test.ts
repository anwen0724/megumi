// Verifies the product runtime persists committed timeline history by default
// (without any caller-provided chat stream sink), and forwards events downstream
// when a sink is supplied. This proves timeline-history commit is product behavior,
// not desktop behavior.
// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
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
import type { ChatStreamEvent } from '@megumi/shared/chat-stream';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ModelStepCompletionResult } from '@megumi/coding-agent/run';
import type { CodingAgentProductRuntime } from '@megumi/coding-agent/product-runtime';

// Seeds a real project row in the same SQLite file the runtime will open, mirroring
// the production invariant that a session's workspaceId is always an opened project's
// id. Without it the run's tool_registry_snapshots insert violates its
// FOREIGN KEY(project_id) REFERENCES projects(project_id) constraint.
function seedProject(homePath: string): { projectId: string; repoPath: string } {
  const database = createDatabase(path.join(homePath, 'megumi.sqlite3'));
  try {
    migrateDatabase(database);
    const project = new ProjectRepository(database).upsertFromRepoPath({
      repoPath: homePath,
      now: '2026-06-24T00:00:00.000Z',
    });
    return { projectId: project.projectId, repoPath: project.repoPath };
  } finally {
    database.close();
  }
}

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

// A model step provider that emits a single completed assistant answer, which the
// run loop turns into a terminal `turn.completed` chat stream event.
function answeringModelStepProvider() {
  return {
    async *streamModelStep(request: { sessionId: string; runId: string; stepId: string }): AsyncIterable<RuntimeEvent> {
      yield {
        eventId: 'event-assistant-completed',
        schemaVersion: 1,
        eventType: 'assistant.output.completed',
        sessionId: request.sessionId,
        runId: request.runId,
        stepId: request.stepId,
        sequence: 1,
        createdAt: '2026-06-24T00:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: { content: 'Hello from the product runtime' },
      } as RuntimeEvent;
    },
    completeModelStep: async (): Promise<ModelStepCompletionResult> => ({ ok: true, text: '' }),
    cancelModelStep: () => false,
  };
}

async function sendOneMessage(runtime: CodingAgentProductRuntime, projectId: string, workspacePath: string) {
  const session = runtime.sessionRunService.createSession({
    title: 'Session',
    workspaceId: projectId,
    workspacePath,
    createdAt: '2026-06-24T00:00:00.000Z',
  });
  const result = await runtime.sessionRunService.sendSessionMessage({
    requestId: 'request-1',
    payload: {
      sessionId: String(session.sessionId),
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      context: { permissionMode: 'default' },
      messages: [{
        id: 'message-local-user',
        role: 'user',
        content: 'Say hello',
        createdAt: '2026-06-24T00:00:00.000Z',
      }],
      createdAt: '2026-06-24T00:00:00.000Z',
    },
  });
  for await (const _event of result.events) {
    // Drain to terminal so the projector commits.
  }
  return String(session.sessionId);
}

describe('Coding Agent product runtime timeline history commit', () => {
  let temporaryHome: string | undefined;
  let runtime: CodingAgentProductRuntime | undefined;

  afterEach(async () => {
    runtime?.dispose();
    runtime = undefined;
    if (temporaryHome) {
      await rm(temporaryHome, { recursive: true, force: true });
      temporaryHome = undefined;
    }
  });

  it('commits timeline history even without a caller-provided chat stream sink', async () => {
    temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'megumi-timeline-commit-'));
    const project = seedProject(temporaryHome);
    runtime = composeCodingAgentRuntime({
      homePaths: {
        homePath: temporaryHome,
        sqlitePath: temporaryHome,
        settingsPath: path.join(temporaryHome, 'settings.json'),
      },
      runtimeLogger: { warn: () => undefined },
      modelStepProviderService: answeringModelStepProvider(),
      appSettingsProvider: appSettingsProvider(),
      memorySettingsProvider: { isMemoryEnabled: () => false },
      permissionSettingsProvider: { loadForProject: async () => ({ allow: [], ask: [], deny: [] }) },
    });

    const sessionId = await sendOneMessage(runtime, project.projectId, project.repoPath);

    const committed = runtime.sessionRunService.listTimelineMessagesBySession({ projectId: project.projectId, sessionId });
    expect(committed.messages.length).toBeGreaterThan(0);
    expect(committed.messages.some((message) => message.role === 'assistant')).toBe(true);
  }, 30000);

  it('forwards chat stream events to a caller-provided sink while still persisting', async () => {
    temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'megumi-timeline-commit-sink-'));
    const project = seedProject(temporaryHome);
    const forwarded: ChatStreamEvent[] = [];
    runtime = composeCodingAgentRuntime({
      homePaths: {
        homePath: temporaryHome,
        sqlitePath: temporaryHome,
        settingsPath: path.join(temporaryHome, 'settings.json'),
      },
      runtimeLogger: { warn: () => undefined },
      modelStepProviderService: answeringModelStepProvider(),
      appSettingsProvider: appSettingsProvider(),
      memorySettingsProvider: { isMemoryEnabled: () => false },
      permissionSettingsProvider: { loadForProject: async () => ({ allow: [], ask: [], deny: [] }) },
      chatStreamEventSink: { publish: (event) => forwarded.push(event) },
    });

    const sessionId = await sendOneMessage(runtime, project.projectId, project.repoPath);

    expect(forwarded.some((event) => event.eventType === 'turn.completed')).toBe(true);
    const committed = runtime.sessionRunService.listTimelineMessagesBySession({ projectId: project.projectId, sessionId });
    expect(committed.messages.length).toBeGreaterThan(0);
  }, 30000);
});
