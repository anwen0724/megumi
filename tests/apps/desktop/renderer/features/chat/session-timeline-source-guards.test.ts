// @vitest-environment node
import fs, { existsSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function projectFileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

describe('session timeline source guards', () => {
  it('ChatTimeline uses runtime chat instead of mock agent flow', () => {
    const source = readProjectFile('apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx');
    const oldHook = 'use' + 'MockAgentFlow';

    expect(source).toContain('useSessionTimeline');
    expect(source).not.toContain(oldHook);
    expect(source).not.toContain('run' + 'MockAgentFlow');
    expect(source).not.toContain('retryLast' + 'MockAgentFlow');
  });

  it('does not export mock agent flow from the chat feature barrel', () => {
    const source = readProjectFile('apps/desktop/src/renderer/features/chat/index.ts');
    const oldFlowFile = 'mock-' + 'agent-flow';
    const oldHookFile = 'use-' + oldFlowFile;

    expect(source).not.toContain('MOCK_' + 'AGENT_TIMINGS');
    expect(source).not.toContain('createMockAgentFailure');
    expect(source).not.toContain('createMockAssistantMessage');
    expect(source).not.toContain('createMockToolCall');
    expect(source).not.toContain('createMockToolResult');
    expect(source).not.toContain('shouldMockAgentFail');
    expect(source).not.toContain('use' + 'MockAgentFlow');
    expect(source).not.toContain(oldFlowFile);
    expect(source).not.toContain(oldHookFile);
  });

  it('removes obsolete mock agent flow files', () => {
    const oldFlowFile = 'mock-' + 'agent-flow';
    const oldHookFile = 'use-' + oldFlowFile;
    const oldMockFiles = [
      `apps/desktop/src/renderer/features/chat/components/${oldFlowFile}.ts`,
      `apps/desktop/src/renderer/features/chat/hooks/${oldHookFile}.ts`,
      `tests/apps/desktop/renderer/features/chat/${oldFlowFile}.test.ts`,
    ];

    for (const file of oldMockFiles) {
      expect(projectFileExists(file), file).toBe(false);
    }
  });

  it('routes renderer session timeline through primary session message APIs', () => {
    const hookSource = readProjectFile('apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts');

    expect(hookSource).toContain('useSessionTimeline');
    expect(hookSource).toContain('IPC_CHANNELS.session.message.send');
    expect(hookSource).toContain('window.megumi.session.message.send');
    expect(hookSource).not.toContain('beginRuntimeChat');
    expect(hookSource).not.toContain(['IPC_CHANNELS', 'chat', 'start'].join('.'));
    expect(hookSource).not.toContain(['window', 'megumi', 'chat'].join('.'));
    expect(hookSource).not.toContain(['useRuntime', 'Chat'].join(''));
    expect(existsSync(path.join(root, 'apps/desktop/src/renderer/features/chat/hooks/use-runtime-chat.ts'))).toBe(false);
  });

  it('does not use local-workspace as a runtime send binding', () => {
    const source = readProjectFile('apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts');

    expect(source).not.toContain("const LOCAL_WORKSPACE_ID = 'local-workspace'");
    expect(source).not.toContain('projectState.currentProjectId ?? LOCAL_WORKSPACE_ID');
  });
});
