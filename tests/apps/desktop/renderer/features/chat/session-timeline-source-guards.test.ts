// @vitest-environment node
import fs, { existsSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const oldWindowChatNamespace = new RegExp([
  String.raw`\bwindow`,
  'megumi',
  String.raw`chat(?!Stream)\b`,
].join(String.raw`\.`));

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
    expect(hookSource).not.toMatch(oldWindowChatNamespace);
    expect(hookSource).not.toContain(['useRuntime', 'Chat'].join(''));
    expect(hookSource).toContain('window.megumi.chatStream.onEvent');
    expect(hookSource).toContain('dispatchChatStreamEvent');
    expect(existsSync(path.join(root, 'apps/desktop/src/renderer/features/chat/hooks/use-runtime-chat.ts'))).toBe(false);
  });

  it('does not use local-workspace as a runtime send binding', () => {
    const source = readProjectFile('apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts');

    expect(source).not.toContain("const LOCAL_WORKSPACE_ID = 'local-workspace'");
    expect(source).not.toContain('projectState.currentProjectId ?? LOCAL_WORKSPACE_ID');
  });

  it('renders live assistant answers from canonical chat stream blocks instead of legacy streamingText', () => {
    const source = readProjectFile('apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx');

    expect(source).toContain('CanonicalTimelineMessage');
    expect(source).toContain('useChatStreamStore');
    expect(source).toContain('chatStreamSessionKey');
    expect(source).toContain('canonicalMessages');
    expect(source).toContain('timelineMessages = canonicalMessages');
    expect(source).not.toContain('StreamingAssistantMessage');
    expect(source).not.toContain('TimelineMessageData');
    expect(source).not.toContain('<StreamingAssistantMessage');
    expect(source).not.toContain('Legacy active tool calls');
    expect(source).not.toContain('completedToolActivities.map');
  });

  it('keeps old standalone processing and tool card components out of the canonical timeline path', () => {
    const source = readProjectFile('apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx');

    expect(source).not.toContain('<ToolActivityRow');
    expect(source).not.toContain('TOOL CALLS');
    expect(source).not.toContain('Answer started');
    expect(source).not.toContain('Megumi is working');
  });

  it('keeps branch and retry ui as renderer intents without active path persistence logic', () => {
    const chatSources = [
      readProjectFile('apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx'),
      readProjectFile('apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts'),
    ].join('\n');

    expect(chatSources).toContain('session.branchDraft.create');
    expect(chatSources).toContain('session.branchDraft.cancel');
    expect(chatSources).toContain('recovery.retry');
    expect(chatSources).not.toContain('SessionActivePathRepository');
    expect(chatSources).not.toContain('session_active_path');
    expect(chatSources).not.toContain('session_branch_markers');
    expect(chatSources).not.toContain('classifyAutomaticModelStepRetry');
    expect(chatSources).not.toContain('getLatestCompletedSessionCompaction');
  });
});
