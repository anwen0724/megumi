// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const pureFiles = [
  'complete.ts',
  'context.ts',
  'errors.ts',
  'event-stream.ts',
  'index.ts',
  'message.ts',
  'model.ts',
  'provider.ts',
  'registry.ts',
  'request.ts',
  'stream.ts',
  'tool-set.ts',
  'usage.ts',
  'providers/openai-compatible.ts',
  'providers/openai.ts',
  'providers/deepseek.ts',
  'providers/anthropic.ts',
];

describe('pure AI package boundary', () => {
  it('keeps runtime and desktop concepts out of pure AI files', () => {
    const violations = pureFiles.flatMap((file) => {
      const path = join(process.cwd(), 'packages/ai', file);
      const source = readFileSync(path, 'utf8');
      const forbidden = [
        '@megumi/shared/runtime',
        'RuntimeEvent',
        'RuntimeError',
        'ModelStepRuntimeRequest',
        'createRuntimeEvent',
        'createRunFailedEvent',
        'createToolCallCreatedEvent',
        'sessionId:',
        'runId:',
        'stepId:',
        '@megumi/desktop',
        'electron',
        'BrowserWindow',
        'ipcMain',
        'better-sqlite3',
      ].filter((pattern) => source.includes(pattern));

      return forbidden.map((pattern) => `${relative(process.cwd(), path)} contains ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps runtime compatibility outside packages/ai', () => {
    expect(existsSync(join(process.cwd(), 'packages/ai', 'compat'))).toBe(false);
  });
});
