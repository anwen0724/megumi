// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('src desktop infrastructure boundaries', () => {
  it('keeps provider credentials in desktop infrastructure and out of renderer response secrets', () => {
    const providerStore = read('src/desktop/infrastructure/provider-settings-store.ts');
    const providerHandler = read('src/desktop/ipc/provider.handler.ts');

    expect(providerStore).toContain('resolveCredential');
    expect(providerStore).toContain('credentialSource');
    expect(providerHandler).not.toContain('apiKey:');
    expect(providerHandler).not.toContain('decrypt(');
  });

  it('keeps desktop infrastructure outside Agent Loop rules', () => {
    const files = [
      'src/desktop/infrastructure/megumi-home.ts',
      'src/desktop/infrastructure/app-settings-store.ts',
      'src/desktop/infrastructure/provider-settings-store.ts',
      'src/desktop/infrastructure/runtime-logger.ts',
      'src/desktop/ipc/settings.handler.ts',
      'src/desktop/ipc/provider.handler.ts',
      'src/desktop/ipc/project.handler.ts',
    ].map(read).join('\n');

    expect(files).not.toContain('parseRawInput');
    expect(files).not.toContain('buildModelContextInput');
    expect(files).not.toContain('streamAssistantMessage');
    expect(files).not.toContain('preflightToolCall');
    expect(files).not.toContain('evaluatePermissionPolicy');
    expect(files).not.toContain('createAgentRunner');
  });

  it('keeps entrypoints unchanged in Plan 3', () => {
    expect(read('forge.config.ts')).toContain('apps/desktop/src/main/index.ts');
    expect(read('forge.config.ts')).toContain('apps/desktop/src/preload/index.ts');
    expect(read('vite.renderer.config.ts')).toContain("root: 'apps/desktop/src/renderer'");
  });
});
