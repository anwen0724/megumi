// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readFiles(relativePaths: string[]): string {
  return relativePaths.map(readProjectFile).join('\n');
}

describe('runtime ipc envelope renderer source guards', () => {
  it('provider store does not define local ApiResult or read old provider result shapes', () => {
    const source = readProjectFile('apps/desktop/src/renderer/entities/provider/store.ts');

    expect(source).not.toContain('interface Api' + 'Result');
    expect(source).not.toContain('result.providers');
    expect(source).not.toContain('throw new Error(result.error');
    expect(source).toContain('RuntimeIpcResult');
    expect(source).toContain('createRendererRuntimeIpcRequest');
  });

  it('runtime chat hook does not cast old ok/error results', () => {
    const source = readProjectFile('apps/desktop/src/renderer/features/chat/hooks/use-runtime-chat.ts');

    expect(source).not.toContain('as { ok: boolean; error?: string }');
    expect(source).not.toContain('throw new Error(result.error');
    expect(source).not.toContain('window.megumi.chat.cancel({ requestId })');
    expect(source).toContain('createRendererRuntimeIpcRequest');
    expect(source).toContain('targetRequestId');
  });

  it('renderer runtime ipc consumers do not call provider or chat preload APIs with raw payloads', () => {
    const source = readFiles([
      'apps/desktop/src/renderer/entities/provider/store.ts',
      'apps/desktop/src/renderer/features/chat/hooks/use-runtime-chat.ts',
    ]);

    expect(source).not.toContain('window.megumi.provider.list()');
    expect(source).not.toContain('window.megumi.provider.update(input)');
    expect(source).not.toContain('window.megumi.provider.setApiKey(input)');
    expect(source).not.toContain('window.megumi.provider.deleteApiKey(input)');
    expect(source).not.toContain('window.megumi.chat.start(request) as');
  });
});
