// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  composeCodingAgentHostInterface,
  composeCodingAgentRuntime,
} from '@megumi/coding-agent/composition';

describe('Agent Run production composition', () => {
  let home: string | undefined;

  afterEach(async () => {
    if (home) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it('composes core runtime separately from the host interface adapter', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'megumi-agent-run-composition-'));
    const options = {
      homePaths: {
        homePath: home,
        sqlitePath: home,
        settingsPath: path.join(home, 'settings.json'),
      },
      runtimeLogger: { warn: () => undefined },
      settingsStorage: {
        readRawSettings: () => ({}),
        writeRawSettings: () => undefined,
      },
    };

    const runtime = composeCodingAgentRuntime(options);
    try {
      expect(runtime.agentRunService.startRun).toEqual(expect.any(Function));
      expect(runtime.modelCallService.modelCall).toEqual(expect.any(Function));
      expect((runtime as unknown as Record<string, unknown>).input).toBeUndefined();
      expect((runtime as unknown as Record<string, unknown>).session).toBeUndefined();
    } finally {
      runtime.dispose();
    }

    const host = composeCodingAgentHostInterface(options);
    try {
      expect(host.input.send).toEqual(expect.any(Function));
      expect(host.session.list).toEqual(expect.any(Function));
    } finally {
      host.dispose();
    }
  });
});
