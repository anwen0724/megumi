// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function projectFileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

describe('runtime chat source guards', () => {
  it('ChatTimeline uses runtime chat instead of mock agent flow', () => {
    const source = readProjectFile('apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx');
    const oldHook = 'use' + 'MockAgentFlow';

    expect(source).toContain('useRuntimeChat');
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
});
