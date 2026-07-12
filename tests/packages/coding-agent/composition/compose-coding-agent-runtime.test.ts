import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  composeCodingAgentPersistence,
  composeCodingAgentRuntime,
  createCompatibilityModelContextProvider,
} from '@megumi/coding-agent/composition';
import { createAgentRunRepository } from '@megumi/coding-agent/agent-run/repositories/agent-run-repository';
import type { SettingsRaw } from '@megumi/coding-agent/settings';
import { AssistantEventStream, type AiClient, type AssistantStreamEvent } from '@megumi/ai';
import { collectEvents } from '../agent-run/agent-run-test-helpers';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => removeTempDirectory(directory)));
});

describe('composeCodingAgentRuntime trace wiring', () => {
  it('keeps compatibility capacity outside Context and preserves selection identity', async () => {
    const provider = createCompatibilityModelContextProvider();
    expect(provider({ providerId: 'provider-1', modelId: 'model-1' })).toEqual({
      providerId: 'provider-1',
      modelId: 'model-1',
      contextWindowTokens: 256_000,
    });

    const contextRoot = join(process.cwd(), 'packages', 'coding-agent', 'context');
    const files = (await readdir(contextRoot, { recursive: true }))
      .filter((file) => file.endsWith('.ts'));
    const sources = await Promise.all(files.map((file) => readFile(join(contextRoot, file), 'utf8')));
    expect(sources.join('\n')).not.toContain('createCompatibilityModelContextProvider');
  });

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

  it('replays persisted Agent Run runtime events after runtime recreation', async () => {
    const home = await createHome();
    const settings = settingsStorage();
    const firstRuntime = composeCodingAgentRuntime({
      homePaths: home.paths,
      runtimeLogger: { warn() {} },
      aiClient: fakeAiClient(),
      settingsStorage: settings,
    });
    let runId = '';

    try {
      runId = await startOneRun(firstRuntime, home.workspaceRoot);
    } finally {
      firstRuntime.dispose();
    }

    const secondRuntime = composeCodingAgentRuntime({
      homePaths: home.paths,
      runtimeLogger: { warn() {} },
      aiClient: fakeAiClient(),
      settingsStorage: settings,
    });

    try {
      expect(secondRuntime.agentRunQueries.listRuntimeEventsByRun).toBeDefined();
      expect(secondRuntime.agentRunQueries.listRuntimeEventsByRun(runId).map((event) => event.eventType))
        .toEqual(expect.arrayContaining([
          'run.started',
          'model_call.started',
          'run.completed',
        ]));
      expect(secondRuntime.agentRunQueries.getRunTranscript(runId)).toEqual({
        status: 'found',
        transcript: { runId, items: [] },
      });
    } finally {
      secondRuntime.dispose();
    }
  });

  it('cleans interrupted Agent Runs during runtime startup and leaves replayable events', async () => {
    const home = await createHome();
    const firstRuntime = composeCodingAgentRuntime({
      homePaths: home.paths,
      runtimeLogger: { warn() {} },
      aiClient: fakeAiClient(),
      settingsStorage: settingsStorage(),
    });
    const workspace = await firstRuntime.workspaceService.openWorkspace({
      root_path: home.workspaceRoot,
    });
    expect(workspace.status).toBe('opened');
    if (workspace.status !== 'opened') return;
    const session = firstRuntime.sessionService.createSession({
      workspace_id: workspace.workspace.workspace_id,
      title: 'Interrupted session',
    });
    expect(session.status).toBe('created');
    const sessionId = session.status === 'created' ? session.session.session_id : 'missing';
    firstRuntime.sessionService.saveUserMessage({
      message_id: 'message-1',
      session_id: sessionId,
      run_id: 'run-waiting',
      content_text: 'write hello world',
      created_at: '2026-07-08T00:00:00.000Z',
    });
    firstRuntime.dispose();

    const seeded = composeCodingAgentPersistence({ sqlitePath: home.paths.sqlitePath });
    const repository = createAgentRunRepository({ database: seeded.database });
    repository.createRun({
      run_id: 'run-waiting',
      workspace_id: workspace.workspace.workspace_id,
      session_id: sessionId,
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      trigger: { type: 'user_input', user_message_id: 'message-1' },
      status: 'waiting_for_approval',
      created_at: '2026-07-08T00:00:00.000Z',
      started_at: '2026-07-08T00:00:00.000Z',
    });
    repository.createApprovalRequest({
      approval_request_id: 'approval-1',
      run_id: 'run-waiting',
      subject: {
        type: 'tool_call',
        tool_call_id: 'tool-call-1',
        tool_name: 'write_file',
        input: { path: 'hello.ts' },
      },
      status: 'pending',
      requested_scope: 'once',
      created_at: '2026-07-08T00:01:00.000Z',
    });
    seeded.database.close();

    const runtime = composeCodingAgentRuntime({
      homePaths: home.paths,
      runtimeLogger: { warn() {} },
      aiClient: fakeAiClient(),
      settingsStorage: settingsStorage(),
    });

    try {
      expect(runtime.agentRunQueries.listRunsBySession(sessionId)[0]?.status).toBe('cancelled');
      expect(runtime.agentRunQueries.listRuntimeEventsByRun('run-waiting').map((event) => event.eventType)).toEqual([
        'approval.resolved',
        'run.cancelled',
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it('wires project skills into SkillService and /skill Agent Run prompts', async () => {
    const home = await createHome();
    const capturedPrompts: string[] = [];
    await writeProjectSkill({
      workspaceRoot: home.workspaceRoot,
      skillId: 'qa:review',
      description: 'Review code changes',
      content: 'Always inspect the diff before making claims.\n',
    });
    const runtime = composeCodingAgentRuntime({
      homePaths: home.paths,
      runtimeLogger: { warn() {} },
      aiClient: capturingAiClient(capturedPrompts),
      settingsStorage: settingsStorage(),
    });

    try {
      const workspace = await runtime.workspaceService.openWorkspace({
        root_path: home.workspaceRoot,
      });
      expect(workspace.status).toBe('opened');
      if (workspace.status !== 'opened') return;

      const skills = await runtime.skillService.listSkills({
        workspaceId: workspace.workspace.workspace_id,
      });
      expect(skills.status).toBe('ok');
      expect(skills.status === 'ok' ? skills.skills.map((skill) => skill.skillId) : [])
        .toContain('qa:review');
      const suggestions = await runtime.commandService.getCommandSuggestions({
        draft_input: '/rev',
        workspaceId: workspace.workspace.workspace_id,
      });
      expect(suggestions).toMatchObject({
        type: 'suggestions',
        groups: [{
          id: 'commands',
        }, {
          id: 'skills',
          items: [{
            name: 'review',
            display: {
              primary: 'review',
              secondary: 'qa:review - Review code changes',
              badge: 'Project',
            },
            completion: {
              replacement_input: '/skill qa:review ',
            },
          }],
        }],
      });
      expect(JSON.stringify(suggestions)).not.toContain(workspace.workspace.workspace_id);

      const run = await runtime.agentRunService.startRun({
        request_id: 'request-skill-1',
        workspace_id: workspace.workspace.workspace_id,
        session: { type: 'new', title: 'Skill run' },
        user_input: { text: '/skill qa:review check this patch' },
        model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      });
      expect(run.status).toBe('started');
      if (run.status !== 'started') return;
      const events = await collectEvents(run.events);
      expect(events.map((event) => event.eventType)).toContain('model_call.started');

      expect(capturedPrompts.join('\n')).toContain('Always inspect the diff before making claims.');
      expect(capturedPrompts.join('\n')).toContain('"skillId":"qa:review"');
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
): Promise<string> {
  const workspace = await runtime.workspaceService.openWorkspace({
    root_path: workspaceRoot,
  });
  expect(workspace.status).toBe('opened');
  if (workspace.status !== 'opened') return '';

  const run = await runtime.agentRunService.startRun({
    request_id: 'request-1',
    workspace_id: workspace.workspace.workspace_id,
    session: { type: 'new', title: 'Trace test' },
    user_input: { text: 'hello' },
    model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
  });
  expect(run.status).toBe('started');
  if (run.status !== 'started') return '';
  await collectEvents(run.events);
  return run.run.run_id;
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

function capturingAiClient(capturedPrompts: string[]): AiClient {
  return {
    stream(request) {
      capturedPrompts.push(JSON.stringify(request.context));
      return AssistantEventStream.from(singleAssistantMessage());
    },
    complete: async () => ({
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'end_turn',
    }),
  };
}

async function writeProjectSkill(input: {
  workspaceRoot: string;
  skillId: string;
  description: string;
  content: string;
}): Promise<void> {
  const skillRoot = join(input.workspaceRoot, '.megumi', 'skills', input.skillId.replace(/:/g, '-'));
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    join(skillRoot, 'SKILL.md'),
    `---\nname: ${input.skillId}\ndescription: ${input.description}\n---\n\n${input.content}`,
    'utf8',
  );
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

async function removeTempDirectory(directory: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(directory, {
        recursive: true,
        force: true,
      });
      return;
    } catch (error) {
      lastError = error;
      await delay(25);
    }
  }
  throw lastError;
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
