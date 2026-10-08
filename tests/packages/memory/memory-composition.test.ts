// @vitest-environment node
import fs from 'fs-extra';
import path from 'node:path';
import { expect, it } from 'vitest';
import { vi } from 'vitest';
import { composeTestApplication } from '../composition/compose-test-application';

it('starts with no memory model, queries without model calls, and releases its database on dispose', async () => {
  const app = composeTestApplication();
  try {
    await app.runtime.start({ backgroundTriggers: 'manual' });
    expect(app.runtime.memory.getStatus()).toMatchObject({
      status: 'ok',
      memory: {
        artifactState: 'empty',
        sourceCount: 0,
        dirty: false,
        extractModel: { status: 'unconfigured' },
        consolidationModel: { status: 'unconfigured' },
      },
    });
    expect(fs.pathExistsSync(path.join(app.home, 'memories'))).toBe(false);
    const settingsPath = path.join(app.home, 'settings.json');
    const config = fs.readJsonSync(settingsPath);
    config.memory = {
      extractModel: {
        providerId: 'test',
        modelId: 'model',
      },
      consolidationModel: {
        providerId: 'missing',
        modelId: 'absent',
      },
    };
    fs.writeJsonSync(settingsPath, config);
    fs.ensureDirSync(path.join(app.workspace, '.megumi'));
    fs.writeJsonSync(path.join(app.workspace, '.megumi', 'settings.json'), {
      providers: { test: { models: { model: { contextWindowTokens: 1 } } } },
    });
    expect(app.runtime.memory.getStatus()).toMatchObject({
      status: 'ok',
      memory: {
        extractModel: {
          status: 'configured',
          selection: config.memory.extractModel,
        },
        consolidationModel: { status: 'unavailable' },
      },
    });
    fs.ensureDirSync(path.join(app.home, 'memories'));
    fs.writeFileSync(path.join(app.home, 'memories', 'old-experiment.md'), 'unverified');
    expect(app.runtime.memory.getStatus()).toMatchObject({
      status: 'ok',
      memory: { artifactState: 'needsRepair' },
    });
    expect(app.contexts).toHaveLength(0);
    await app.runtime.dispose();
    expect(app.runtime.memory.getStatus()).toMatchObject({
      status: 'failed',
      error: { code: 'STORAGE_FAILED' },
    });
  } finally {
    await app.cleanup();
  }
});

it('applies project fallback names and UTF-8 budget to an actual conversation request', async () => {
  const app = composeTestApplication();
  try {
    fs.ensureDirSync(path.join(app.workspace, '.megumi'));
    fs.writeJsonSync(path.join(app.workspace, '.megumi', 'settings.json'), {
      context: {
        instructionFallbackNames: ['TEAM.md'],
        instructionMaxBytes: 1024,
      },
    });
    fs.writeFileSync(path.join(app.workspace, 'AGENTS.override.md'), ' \n');
    fs.writeFileSync(path.join(app.workspace, 'TEAM.md'), '汉'.repeat(500));
    const opened = await app.runtime.workspace.useExistingProject();
    if (opened.status !== 'opened' || !opened.project) throw new Error('Workspace was not opened.');
    const sent = await app.runtime.session.sendUserInput({
      projectId: opened.project.projectId,
      text: 'Hello',
    });
    expect(sent.payload.type).toBe('agent_run');
    await vi.waitFor(() => expect(app.contexts.length).toBeGreaterThan(0));
    const request = JSON.stringify(app.contexts[0]);
    expect(request).toContain('TEAM.md');
    expect(request).toContain('汉'.repeat(341));
    expect(request).not.toContain('汉'.repeat(342));
    expect(request).toContain('truncated=\\"true\\"');
    expect(request).toContain('scope=');
    expect(app.runtime.memory.getStatus()).toMatchObject({
      status: 'ok',
      memory: { sourceCount: 1 },
    });
  } finally {
    await app.cleanup();
  }
});

it('rejects re-enabling memory through application settings while clear remains pending', async () => {
  const app = composeTestApplication();
  try {
    fs.ensureDirSync(path.join(app.home, 'memories'));
    // Unknown legacy files are not silently removed by the new memory owner.
    fs.writeFileSync(path.join(app.home, 'memories', 'unknown-legacy.txt'), 'preserve');
    const accepted = app.runtime.memory.clearMemory({
      requestId: 'clear',
      confirmed: true,
    });
    if (accepted.status !== 'started') throw new Error('Clear not accepted');
    expect(
      await app.runtime.memory.waitRun({
        runId: accepted.runId,
        timeoutMs: 5000,
      }),
    ).toMatchObject({ run: { status: 'failed' } });
    const read = app.runtime.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Settings unavailable');
    expect(
      app.runtime.settings.updateSettings({
        expectedRevision: read.settings.revision,
        patch: {
          memory: {
            generateMemories: true,
            useMemories: true,
          },
        },
      }),
    ).toMatchObject({
      status: 'rejected',
      error: { code: 'SETTINGS_CONFLICT' },
    });
    expect(fs.readFileSync(path.join(app.home, 'memories', 'unknown-legacy.txt'), 'utf8')).toBe(
      'preserve',
    );
  } finally {
    await app.cleanup();
  }
});
