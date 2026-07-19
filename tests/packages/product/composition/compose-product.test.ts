// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { AssistantEventStream, type AiClient, type AssistantStreamEvent } from '@megumi/ai';
import { composeProduct } from '@megumi/product/composition';
import type { SettingsRaw } from '@megumi/agent/settings';

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
      logWriter: { appendText: () => undefined },
      directoryPicker: {
        chooseDirectory: async () => ({ canceled: false, filePaths: [workspaceRoot] }),
      },
      aiClient: fakeAiClient(),
      settingsStorage: settingsStorage(),
    });

    try {
      expect(product.homePaths.homePath).toBe(homePath);
      expect(fs.pathExistsSync(product.homePaths.settingsSchemaPath)).toBe(true);

      const opened = await product.host.workspace.useExistingProject();
      if (opened.status !== 'opened') return;
      expect(opened.project?.rootPath).toBe(workspaceRoot);

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
        permissionMode: 'ask',
      });

      expect(result.payload.type).toBe('agent_run');
      if (result.payload.type !== 'agent_run' || !result.events) return;
      const events = [];
      for await (const event of result.events) events.push(event.eventType);
      expect(events).toContain('run.completed');
    } finally {
      product.dispose();
    }
  });
});

function settingsStorage() {
  let settings: SettingsRaw = {
    providers: {
      deepseek: {
        enabled: true,
        protocol: 'openai-compatible',
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

function fakeAiClient(): AiClient {
  return {
    stream: () => AssistantEventStream.from(singleAssistantMessage()),
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
