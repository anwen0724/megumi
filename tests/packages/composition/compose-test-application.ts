/* Builds an isolated Application with scripted model streams for Composition tests. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { composeApplication, type ProductRuntime } from '@megumi/composition';
import type { Api, AssistantMessage, Model, ProviderStreams } from '@megumi/ai';
import { AssistantMessageEventStream } from '@megumi/ai/utils/event-stream';
import { nodeObservabilityStorage } from '@megumi/observability';
import { createNodeWorkspaceFileSystem } from '@megumi/workspace/node';

export interface TestApplication {
  readonly runtime: ProductRuntime;
  readonly root: string;
  readonly home: string;
  readonly workspace: string;
  readonly contexts: readonly unknown[];
  cleanup(): Promise<void>;
}

export function composeTestApplication(responses: readonly string[] = ['Test reply.']): TestApplication {
  const root = mkdtempSync(path.join(tmpdir(), 'megumi-composition-'));
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const scripted = createScriptedStreams(responses);
  let settings: Readonly<Record<string, unknown>> = {
    setup: { completed: true, completed_at: '2026-01-01T00:00:00.000Z' },
    providers: {
      test: {
        enabled: true,
        api: 'openai-completions',
        base_url: 'https://example.test/v1',
        models: { model: { context_window_tokens: 64_000, max_output_tokens: 2_048 } },
      },
    },
    model_selection: { provider_id: 'test', model_id: 'model' },
    discovery: {
      conversation_recognition_enabled: true,
      recommendation_generation_time: '08:00',
      recommendation_target_count: 20,
      recommendation_working_set_count: 80,
      enabled_sources: ['open_web'],
    },
  };
  const runtime = composeApplication({
    home: {
      env: { MEGUMI_HOME: home },
      homeDirectory: root,
      fileSystem: {
        ensureDirSync: fs.ensureDirSync,
        pathExistsSync: fs.pathExistsSync,
        writeJsonSync: fs.writeJsonSync,
        writeFileSync: fs.writeFileSync,
        copyDirectorySync: fs.copySync,
      },
      clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    },
    workspaceFileSystem: createNodeWorkspaceFileSystem(),
    observabilityStorage: nodeObservabilityStorage,
    modelStreams: { 'openai-completions': scripted.streams },
    settingsStorage: {
      read: () => structuredClone(settings),
      write: (next) => { settings = structuredClone(next); },
    },
    directoryPicker: { chooseDirectory: async () => ({ canceled: false, filePaths: [workspace] }) },
    clock: { now: () => '2026-01-01T00:00:00.000Z' },
    createApplicationId: createTestId,
  });
  return {
    runtime,
    root,
    home,
    workspace,
    contexts: scripted.contexts,
    async cleanup() {
      await runtime.dispose().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function createScriptedStreams(responses: readonly string[]): {
  readonly streams: ProviderStreams;
  readonly contexts: unknown[];
} {
  let index = 0;
  const contexts: unknown[] = [];
  const stream: ProviderStreams['stream'] = (model, context) => {
    contexts.push(context);
    const text = responses[Math.min(index, responses.length - 1)] ?? 'Test reply.';
    index += 1;
    return assistantStream(model, text);
  };
  return { streams: { stream, streamSimple: stream }, contexts };
}

function assistantStream(model: Model<Api>, text: string): AssistantMessageEventStream {
  const events = new AssistantMessageEventStream();
  const message: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0.001, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.002 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
  events.push({ type: 'start', partial: { ...message, content: [] } });
  events.push({
    type: 'text_delta',
    contentIndex: 0,
    delta: text,
    partial: message,
  });
  events.push({ type: 'done', reason: 'stop', message });
  return events;
}

let id = 0;
function createTestId(scope: string): string {
  id += 1;
  return `test:${scope}:${id}`;
}
