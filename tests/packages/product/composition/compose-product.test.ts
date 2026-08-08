// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeProduct } from '@megumi/product';
import type { AnyEvent } from '@megumi/events';
import { createNodeWorkspaceFileSystem } from '@megumi/workspace/node';
import { AssistantMessageEventStream } from '../../../../packages/ai/src/utils/event-stream';
import {
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
      workspaceFileSystem: createNodeWorkspaceFileSystem(),
      modelStreams: {
        'openai-completions': modelScript.streams,
      },
      settingsStorage: settingsStorage(),
    });

    try {
      expect(fs.pathExistsSync(join(homePath, 'settings.schema.json'))).toBe(true);

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
              tools: expect.arrayContaining([expect.objectContaining({ registeredToolName: 'read_file' })]),
            },
          },
        },
      });

      const session = await product.host.session.createSession({
        projectId: opened.project.projectId,
        title: 'Product-only run',
      });
      if (session.status !== 'created') return;
      const result = await product.host.session.sendUserInput({
        projectId: opened.project.projectId,
        sessionId: session.session.id,
        text: 'hello',
        modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
        permissionMode: 'full_access',
      });

      expect(result.payload.type).toBe('agent_run');
      if (result.payload.type !== 'agent_run') return;
      const payload = result.payload;
      // The Run executes in the background; poll the persisted run events
      // until it settles before asserting on the event facts.
      let events: AnyEvent[] = [];
      await vi.waitFor(async () => {
        const snapshot = await product.host.session.listRunEvents({ runId: payload.run.runId });
        events = snapshot.events;
        expect(snapshot.events.some((event) => event.type === 'run.ended')).toBe(true);
      }, { timeout: 5000 });
      expect(events.filter((event) => event.type === 'tool_execution.ended')).toHaveLength(2);
      expect(events.map((event) => event.type)).toContain('run.ended');

      // Manual /compact runs through Product with the tools-less request and no
      // per-request bus; the command still completes through Context.compact.
      const compacted = await product.host.session.sendUserInput({
        projectId: opened.project.projectId,
        sessionId: session.session.id,
        text: '/compact',
        modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
        permissionMode: 'full_access',
      });
      expect(compacted.payload.type).toBe('completed');

      const firstContext = modelScript.contexts[0] as {
        systemPrompt?: string;
        tools?: Array<{
          name: string;
          description: string;
          parameters?: { properties?: Record<string, { description?: string }> };
        }>;
      };
      expect(firstContext.systemPrompt).toContain(`<working_directory>${workspaceRoot}</working_directory>`);
      expect(firstContext.systemPrompt).toContain('<operating_system>');
      expect(firstContext.systemPrompt).toContain('<shell>');
      expect(firstContext.systemPrompt).toContain('<available_skills>');
      expect(firstContext.systemPrompt).toContain('<name>review</name>');
      const listDirectory = firstContext.tools?.find((tool) => tool.name === 'list_directory');
      expect(listDirectory).toMatchObject({
        description: 'List files and directories. Returns up to 100 entries per page by default; when hasMore is true, continue with nextOffset. Use limit, offset, maxDepth, and includeHidden to control the traversal.',
        promptSnippet: 'List files and directories.',
        parameters: {
          properties: {
            path: {
              description: 'The directory to list. Relative paths are resolved from the current working directory.',
            },
          },
        },
      });
      expect(JSON.stringify(modelScript.contexts[2])).toContain('Review the changed files.');
      const firstDispose = product.dispose();
      expect(product.dispose()).toBe(firstDispose);
      await firstDispose;
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
      // The model reads the Skill package dynamically through the normal file Tool.
      return assistantStream(model, 'I will read the review Skill package.', {
        id: 'tool-call:read-review-skill',
        name: 'read_file',
        arguments: { path: skillPath },
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
