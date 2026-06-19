// @vitest-environment node
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDesktopEnvFile } from '../../../src/desktop/infrastructure/env-file';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'megumi-env-file-'));
  roots.push(root);
  return root;
}

describe('desktop env file loading', () => {
  it('loads root .env values without overwriting existing environment values', async () => {
    const root = await tempRoot();
    const env: Record<string, string | undefined> = {
      OPENAI_API_KEY: 'existing-openai-key',
    };
    await fsp.writeFile(
      path.join(root, '.env'),
      [
        '# comment',
        'DEEPSEEK_API_KEY="sk-deepseek-from-file"',
        'OPENAI_API_KEY=sk-openai-from-file',
        "CUSTOM_DEEPSEEK_KEY='sk-custom-from-file'",
        '',
      ].join('\n'),
      'utf8',
    );

    loadDesktopEnvFile({ cwd: root, env });

    expect(env.DEEPSEEK_API_KEY).toBe('sk-deepseek-from-file');
    expect(env.OPENAI_API_KEY).toBe('existing-openai-key');
    expect(env.CUSTOM_DEEPSEEK_KEY).toBe('sk-custom-from-file');
  });
});
