/*
 * Verifies that Agent composition exposes owner services to Product without
 * constructing the retired AgentRun or ModelCall execution services.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  composeAgentRuntime,
  createSettingsModelContextProvider,
} from '@megumi/agent/composition';
import { createSettingsService, type SettingsRaw } from '@megumi/agent/settings';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(removeTempDirectory));
});

describe('composeAgentRuntime owner wiring', () => {
  it('reads model capacity through resolved Settings without coupling Context to the resolver', async () => {
    const provider = createSettingsModelContextProvider(createSettingsService({
      file_store: settingsStorage(),
    }));
    expect(provider({ providerId: 'deepseek', modelId: 'deepseek-chat' })).toEqual({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      contextWindowTokens: 256_000,
    });

    const contextRoot = join(process.cwd(), 'packages', 'agent', 'context');
    const files = (await readdir(contextRoot, { recursive: true }))
      .filter((file) => file.endsWith('.ts'));
    const sources = await Promise.all(
      files.map((file) => readFile(join(contextRoot, file), 'utf8')),
    );
    expect(sources.join('\n')).not.toContain('createSettingsModelContextProvider');
  });

  it('exposes owner capabilities and does not create retired Run services or trace files', async () => {
    const home = await createHome();
    const runtime = composeAgentRuntime({
      homePaths: home.paths,
      runtimeLogger: { warn() {} },
      settingsStorage: settingsStorage(),
      models: {
        completeSimple: async () => {
          throw new Error('not used');
        },
      },
    });

    try {
      expect(runtime.inputService.processUserInput).toBeTypeOf('function');
      expect(runtime.contextRuntime.contextService.build).toBeTypeOf('function');
      expect(runtime.sessionService.saveUserMessage).toBeTypeOf('function');
      expect(runtime.permissionService.evaluateToolCall).toBeTypeOf('function');
      expect(runtime.toolRegistryService.listAvailableTools).toBeTypeOf('function');
      expect(runtime).not.toHaveProperty('agentRunService');
      expect(runtime).not.toHaveProperty('modelCallService');
      expect(existsSync(join(home.homePath, 'logs', 'agent-run-trace.jsonl'))).toBe(false);
    } finally {
      runtime.dispose();
    }
  });

  it('resolves workspace Skills and creates a run-scoped Tool execution capability', async () => {
    const home = await createHome();
    await writeProjectSkill({
      workspaceRoot: home.workspaceRoot,
      name: 'review',
      description: 'Review code changes',
      content: 'Always inspect the diff before making claims.\n',
    });
    const runtime = composeAgentRuntime({
      homePaths: home.paths,
      runtimeLogger: { warn() {} },
      settingsStorage: settingsStorage(),
      models: {
        completeSimple: async () => {
          throw new Error('not used');
        },
      },
    });

    try {
      const workspace = await runtime.workspaceService.openWorkspace({
        root_path: home.workspaceRoot,
      });
      expect(workspace.status).toBe('opened');
      if (workspace.status !== 'opened') return;

      const skills = await runtime.createSkillService({
        workspaceId: workspace.workspace.workspace_id,
      }).listSkills({});
      expect(skills).toMatchObject({
        status: 'ok',
        skills: [expect.objectContaining({
          name: 'review',
          source: { owner: 'user' },
        })],
      });
      const suggestions = await runtime.commandService.getCommandSuggestions({
        draft_input: '/rev',
        workspaceId: workspace.workspace.workspace_id,
      });
      expect(suggestions).toMatchObject({
        type: 'suggestions',
        groups: expect.arrayContaining([expect.objectContaining({
          id: 'skills',
          items: [expect.objectContaining({
            name: 'review',
            completion: {
              replacement_input: '',
              selection: expect.objectContaining({ name: 'review' }),
            },
          })],
        })]),
      });

      const toolExecution = runtime.toolExecutionForRun({
        runId: 'run:1',
        sessionId: 'session:1',
        workspaceId: workspace.workspace.workspace_id,
      });
      expect(toolExecution.executeTool).toBeTypeOf('function');
      expect(() => runtime.toolExecutionForRun({
        runId: 'run:missing-workspace',
        sessionId: 'session:1',
        workspaceId: 'workspace:missing',
      })).toThrow('Workspace workspace:missing is unavailable for Tool execution.');
    } finally {
      runtime.dispose();
    }
  });
});

async function createHome(): Promise<{
  homePath: string;
  workspaceRoot: string;
  paths: Parameters<typeof composeAgentRuntime>[0]['homePaths'];
}> {
  const homePath = await mkdtemp(join(tmpdir(), 'megumi-agent-composition-'));
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
      attachmentsPath: join(homePath, 'attachments'),
    },
  };
}

function settingsStorage() {
  let settings: SettingsRaw = {
    providers: {
      deepseek: {
        enabled: true,
        api: 'openai-completions',
        base_url: 'https://api.example.com/v1',
        models: { 'deepseek-chat': {} },
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

async function writeProjectSkill(input: {
  workspaceRoot: string;
  name: string;
  description: string;
  content: string;
}): Promise<void> {
  const skillRoot = join(input.workspaceRoot, '.megumi', 'skills', input.name);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    join(skillRoot, 'SKILL.md'),
    `---\nname: ${input.name}\ndescription: ${input.description}\n---\n\n${input.content}`,
    'utf8',
  );
}

async function removeTempDirectory(directory: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(25);
    }
  }
  throw lastError;
}
