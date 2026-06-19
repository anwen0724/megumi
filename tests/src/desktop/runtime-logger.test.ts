// @vitest-environment node
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeJsonlLogger } from '../../../src/desktop/infrastructure/runtime-logger';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'megumi-runtime-log-'));
  roots.push(root);
  return root;
}

describe('runtime logger', () => {
  it('writes redacted JSONL entries', async () => {
    const root = await tempRoot();
    const logPath = path.join(root, 'runtime.jsonl');
    const logger = createRuntimeJsonlLogger({
      filePath: logPath,
      now: () => '2026-06-19T00:00:00.000Z',
    });

    logger.info('provider.request', {
      providerId: 'deepseek',
      apiKey: 'sk-test-secret',
      nested: { authorization: 'Bearer secret-value' },
    });

    const lines = (await fsp.readFile(logPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      timestamp: '2026-06-19T00:00:00.000Z',
      level: 'info',
      event: 'provider.request',
      details: {
        providerId: 'deepseek',
        apiKey: '[redacted]',
        nested: { authorization: '[redacted]' },
      },
    });
  });
});
