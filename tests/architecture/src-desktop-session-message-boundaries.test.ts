import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('src desktop session message boundaries', () => {
  it('keeps UI request adaptation thin and local to session.message.send', () => {
    const hook = read('src/ui/features/chat/hooks/use-session-timeline.ts');
    const adapter = read('src/ui/features/chat/hooks/session-message-send-request.ts');

    expect(hook).toContain('createSessionMessageSendRequestDto');
    expect(hook).not.toContain('SessionMessageSendPayload');
    expect(hook).not.toContain('as never');
    expect(adapter).toContain('SessionMessageSendRequestDto');
    expect(adapter).not.toContain('createRendererRuntimeIpcRequest');
    expect(adapter).not.toContain('window.megumi');
  });

  it('keeps UI session message tests on real types instead of cast escapes', () => {
    const test = read('tests/src/ui/session-message-send-request.test.ts');

    expect(test).not.toContain('as never');
  });

  it('does not preserve old renderer runtime envelope compatibility for message send', () => {
    const mapper = read('src/desktop/mappers/app-request.mapper.ts');

    expect(mapper).toContain('isSessionMessageSendRequestDto');
    expect(mapper).toContain('session.message.send expects SessionMessageSendRequestDto');
    expect(mapper).not.toContain('payload.message.content');
    expect(mapper).not.toContain('operationName');
    expect(mapper).not.toContain('rendererChannel');
  });

  it('keeps desktop outside Agent Loop owner responsibilities', () => {
    const handler = read('src/desktop/ipc/session.handler.ts');
    const mapper = read('src/desktop/mappers/app-request.mapper.ts');
    const combined = `${handler}\n${mapper}`;

    expect(handler).toContain("operation === 'session.message.send'");
    expect(handler).toContain('context.appApi.startRun');
    expect(combined).not.toContain('parseRawInput');
    expect(combined).not.toContain('dispatchCommand');
    expect(combined).not.toContain('createAgentRunner');
    expect(combined).not.toContain('buildModelContextInput');
    expect(combined).not.toContain('streamAssistantMessage');
    expect(combined).not.toContain('preflightToolCall');
    expect(combined).not.toContain('evaluatePermissionPolicy');
    expect(combined).not.toContain('openSqliteDatabase');
  });

  it('keeps Electron and Vite entrypoints on src after Plan 6', () => {
    expect(read('forge.config.ts')).toContain('src/desktop/main.ts');
    expect(read('forge.config.ts')).toContain('src/desktop/preload/index.ts');
    expect(read('vite.main.config.ts')).toContain("path.resolve(__dirname, 'src/desktop')");
    expect(read('vite.preload.config.ts')).toContain("path.resolve(__dirname, 'src/desktop')");
    expect(read('vite.renderer.config.ts')).toContain("root: 'src/ui'");
  });
});
