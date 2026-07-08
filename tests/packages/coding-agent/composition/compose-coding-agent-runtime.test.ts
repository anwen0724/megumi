import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { composeCodingAgentRuntime } from '@megumi/coding-agent/composition';
import type { SettingsRaw } from '@megumi/coding-agent/settings';
import { AssistantEventStream, type AiClient, type AssistantStreamEvent } from '@megumi/ai';
import { collectEvents } from '../agent-run/agent-run-test-helpers';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('composeCodingAgentRuntime trace wiring', () => {
  it('writes Agent Run trace JSONL to the Megumi Home logs directory', async () => {
    const home = await createHome();
    const runtime = composeCodingAgentRuntime({
      homePaths: home.paths,
      runtimeLogger: { warn() {} },
      aiClient: fakeAiClient(),
      settingsStorage: settingsStorage(),
    });

    try {
      await startOneRun(runtime, home.workspaceRoot);
      const logPath = join(home.homePath, 'logs', 'agent-run-trace.jsonl');
      const records = await waitForTraceEvents(logPath, [
        'run.started',
        'trace.prompt.built',
        'run.completed',
      ]);
      expect(records)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ event_type: 'run.started' }),
          expect.objectContaining({ event_type: 'trace.prompt.built' }),
          expect.objectContaining({ event_type: 'run.completed' }),
        ]));
    } finally {
      runtime.dispose();
    }
  });
});

async function createHome(): Promise<{
  homePath: string;
  workspaceRoot: string;
  paths: Parameters<typeof composeCodingAgentRuntime>[0]['homePaths'];
}> {
  const homePath = await mkdtemp(join(tmpdir(), 'megumi-runtime-trace-'));
  tempDirectories.push(homePath);
  const workspaceRoot = join(homePath, 'workspace');
  await mkdir(workspaceRoot);
  return {
    homePath,
    workspaceRoot,
    paths: {
      homePath,
      sqlitePath: join(homePath, 'sqlite'),
      settingsPath: join(homePath, 'settings.json'),
    },
  };
}

async function startOneRun(
  runtime: ReturnType<typeof composeCodingAgentRuntime>,
  workspaceRoot: string,
): Promise<void> {
  const workspace = await runtime.workspaceService.openWorkspace({
    root_path: workspaceRoot,
    opened_at: '2026-07-08T00:00:00.000Z',
  });
  expect(workspace.status).toBe('opened');
  if (workspace.status !== 'opened') return;

  const run = await runtime.agentRunService.startRun({
    request_id: 'request-1',
    workspace_id: workspace.workspace.workspace_id,
    session: { type: 'new', title: 'Trace test' },
    user_input: { text: 'hello' },
    model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
  });
  expect(run.status).toBe('started');
  if (run.status !== 'started') return;
  await collectEvents(run.events);
}

function settingsStorage() {
  let settings: SettingsRaw = {
    providers: {
      deepseek: {
        enabled: true,
        protocol: 'openai-compatible',
        base_url: 'https://api.example.com/v1',
        models: ['deepseek-chat'],
        api_key: 'test-api-key',
      },
    },
  };
  return {
    readRawSettings: () => settings,
    writeRawSettings: (next: SettingsRaw) => {
      settings = next;
    },
  };
}

function fakeAiClient(): AiClient {
  return {
    stream() {
      return AssistantEventStream.from(singleAssistantMessage());
    },
    complete: async () => ({
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'end_turn',
    }),
  };
}

async function* singleAssistantMessage(): AsyncIterable<AssistantStreamEvent> {
  yield {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'end_turn',
    },
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('Timed out waiting for trace file.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForTraceEvents(
  logPath: string,
  expectedEventTypes: string[],
): Promise<Array<{ event_type: string }>> {
  let records: Array<{ event_type: string }> = [];
  await waitFor(async () => {
    if (!existsSync(logPath)) {
      return false;
    }

    const content = (await readFile(logPath, 'utf8')).trim();
    records = content
      ? content.split('\n').map((line) => JSON.parse(line) as { event_type: string })
      : [];
    const actualEventTypes = new Set(records.map((record) => record.event_type));
    return expectedEventTypes.every((eventType) => actualEventTypes.has(eventType));
  });
  return records;
}
