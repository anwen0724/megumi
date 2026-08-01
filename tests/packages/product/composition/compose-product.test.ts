// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { composeProduct } from '@megumi/product';
import { createSandbox, resolveSandboxBackend } from '@megumi/sandbox';
import {
  AssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
  type ProviderStreams,
} from '@megumi/ai';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('composeProduct', () => {
  it('initializes Home and starts an Agent Run through Product Host without Desktop', async () => {
    const root = mkdtempSync(join(tmpdir(), 'megumi-product-'));
    tempDirectories.push(root);
    const homePath = join(root, 'home');
    const workspaceRoot = join(root, 'workspace');
    mkdirSync(workspaceRoot);
    fs.writeFileSync(join(workspaceRoot, 'README.md'), '# Product integration\n');
    fs.outputFileSync(
      join(workspaceRoot, '.megumi', 'skills', 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Review workspace changes\n---\nReview the changed files.\n',
    );
    const skillPath = join(workspaceRoot, '.megumi', 'skills', 'review', 'SKILL.md');
    const modelScript = toolThenReplyStreams(skillPath);
    const product = composeProduct({
      sandbox: createSandbox({ backend: resolveSandboxBackend() }),
      home: {
        env: { MEGUMI_HOME: homePath },
        homeDirectory: root,
        fileSystem: {
          ensureDirSync: fs.ensureDirSync,
          pathExistsSync: fs.pathExistsSync,
          writeJsonSync: fs.writeJsonSync,
          writeFileSync: fs.writeFileSync,
          copyDirectorySync: fs.copySync,
        },
        clock: { now: () => new Date('2026-07-10T00:00:00.000Z') },
      },
      directoryPicker: {
        chooseDirectory: async () => ({ canceled: false, filePaths: [workspaceRoot] }),
      },
      modelStreams: {
        'openai-completions': modelScript.streams,
      },
      settingsStorage: settingsStorage(),
    });

    try {
      expect(product.homePaths.homePath).toBe(homePath);
      expect(fs.pathExistsSync(product.homePaths.settingsSchemaPath)).toBe(true);
      const resolvedModel = await product.resolveModel({
        provider_id: 'deepseek',
        model_id: 'deepseek-chat',
      });
      expect(resolvedModel.status).toBe('ok');
      if (resolvedModel.status === 'ok') {
        expect(resolvedModel.model).toMatchObject({
          provider: 'deepseek',
          id: 'deepseek-chat',
          api: 'openai-completions',
          contextWindow: 64_000,
        });
      }
      expect(JSON.stringify(resolvedModel)).not.toContain('test-api-key');

      const opened = await product.host.workspace.useExistingProject();
      if (opened.status !== 'opened') return;
      expect(opened.project?.rootPath).toBe(workspaceRoot);
      const workspaceSkills = await product.host.skill.listSkills({ workspaceId: opened.project.projectId });
      expect(workspaceSkills).toMatchObject({
        status: 'ok',
        skills: expect.arrayContaining([expect.objectContaining({ name: 'review', available: true })]),
      });
      const settings = await product.host.settings.get({});
      expect(settings).toMatchObject({
        status: 'ok',
        settings: {
          permissions: {
            catalog: {
              tools: expect.arrayContaining([expect.objectContaining({ registeredToolName: 'use_skill' })]),
            },
          },
        },
      });

      const session = await product.host.chat.createSession({
        projectId: opened.project.projectId,
        title: 'Product-only run',
      });
      if (session.status !== 'created') return;
      const result = await product.host.chat.sendUserInput({
        projectId: opened.project.projectId,
        sessionId: session.session.id,
        text: 'hello',
        modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
        permissionMode: 'full_access',
      });

      expect(result.payload.type).toBe('agent_run');
      if (result.payload.type !== 'agent_run' || !result.events) return;
      const events = [];
      for await (const event of result.events) events.push(event.eventType);
      expect(events.filter((eventType) => eventType === 'tool.execution.completed')).toHaveLength(2);
      expect(events).toContain('run.completed');

      const firstContext = modelScript.contexts[0] as {
        systemPrompt?: string;
        tools?: Array<{
          name: string;
          description: string;
          parameters?: { properties?: Record<string, { description?: string }> };
        }>;
      };
      expect(firstContext.systemPrompt).toContain(`Working directory: ${workspaceRoot}`);
      expect(firstContext.systemPrompt).toContain('Operating system:');
      expect(firstContext.systemPrompt).toContain('Shell:');
      const listDirectory = firstContext.tools?.find((tool) => tool.name === 'list_directory');
      expect(listDirectory).toMatchObject({
        description: 'List files and directories.',
        parameters: {
          properties: {
            path: {
              description: 'The directory to list. Relative paths are resolved from the current working directory.',
            },
          },
        },
      });
      expect(JSON.stringify(modelScript.contexts[2])).toContain('Review the changed files.');
    } finally {
      await product.dispose();
    }
  });
});

function settingsStorage() {
  let settings: Record<string, unknown> = {
    providers: {
      deepseek: {
        enabled: true,
        api: 'openai-completions',
        base_url: 'https://api.example.com/v1',
        models: { 'deepseek-chat': { context_window_tokens: 64_000 } },
        api_key: 'test-api-key',
      },
    },
  };
  return {
    read: () => settings,
    write: (next: Readonly<Record<string, unknown>>) => {
      settings = next;
    },
  };
}

function toolThenReplyStreams(skillPath: string): { streams: ProviderStreams; contexts: unknown[] } {
  let callCount = 0;
  const contexts: unknown[] = [];
  const stream: ProviderStreams['stream'] = (model, context) => {
    callCount += 1;
    contexts.push(context);
    if (callCount === 1) {
      return assistantStream(model, 'I will read the workspace file.', {
          id: 'tool-call:read-readme',
          name: 'read_file',
          arguments: { path: 'README.md' },
        });
    }
    if (callCount === 2) {
      return assistantStream(model, 'I will load the selected review method.', {
        id: 'tool-call:use-review-skill',
        name: 'use_skill',
        arguments: { skillPath },
      });
    }
    return assistantStream(model, 'Product integration reply.');
  };
  return { streams: { stream, streamSimple: stream }, contexts };
}

function assistantStream(
  model: Model<Api>,
  text: string,
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> },
): AssistantMessageEventStream {
    const events = new AssistantMessageEventStream();
    const content: AssistantMessage['content'] = [{ type: 'text', text }];
    if (toolCall) {
      content.push({
        type: 'toolCall',
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      });
    }
    const message: AssistantMessage = {
      role: 'assistant' as const,
      content,
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: toolCall ? 'toolUse' : 'stop',
      timestamp: Date.now(),
    };
    events.push({ type: 'start', partial: { ...message, content: [] } });
    events.push({
      type: 'text_delta',
      contentIndex: 0,
      delta: text,
      partial: { ...message, content: [{ type: 'text', text }] },
    });
    if (toolCall) {
      events.push({
        type: 'toolcall_end',
        contentIndex: 1,
        toolCall: content[1] as Extract<AssistantMessage['content'][number], { type: 'toolCall' }>,
        partial: message,
      });
    }
    events.push({ type: 'done', reason: toolCall ? 'toolUse' : 'stop', message });
    return events;
}
