import { describe, expect, it } from 'vitest';
import type { TimelineAssistantMessage, TimelineUserMessage } from '@megumi/coding-agent/projections/timeline';
import { createBranchDraftViewInput } from '@megumi/desktop/renderer/features/chat/branch-draft-preview';

describe('createBranchDraftViewInput', () => {
  it('uses the assistant reply text when the branched reply has visible answer text', () => {
    const assistant = assistantMessage({
      messageId: 'message-assistant-1',
      runId: 'run-1',
      text: '我是 Megumi，一个 AI 编程助手！🤖',
    });

    expect(createBranchDraftViewInput(assistant, [
      userMessage({ messageId: 'message-user-1', runId: 'run-1', text: '你是谁？' }),
      assistant,
    ])).toEqual({
      messageId: 'message-assistant-1',
      sourceKind: 'reply',
      preview: '我是 Megumi，一个 AI 编程助手！🤖',
    });
  });

  it('falls back to the same-run user input when the reply has no visible answer text', () => {
    const assistant = assistantMessage({
      messageId: 'message-assistant-1',
      runId: 'run-1',
      text: '',
    });

    expect(createBranchDraftViewInput(assistant, [
      userMessage({ messageId: 'message-user-other', runId: 'run-other', text: '不要使用这一条' }),
      userMessage({ messageId: 'message-user-1', runId: 'run-1', text: '解释这个报错' }),
      assistant,
    ])).toEqual({
      messageId: 'message-assistant-1',
      sourceKind: 'input',
      preview: '解释这个报错',
    });
  });
});

function userMessage(input: {
  messageId: string;
  runId: string;
  text: string;
}): TimelineUserMessage {
  return {
    messageId: input.messageId,
    role: 'user',
    projectId: 'workspace-1',
    sessionId: 'session-1',
    runId: input.runId,
    createdAt: '2026-07-09T03:13:25.326Z',
    blocks: [{
      blockId: `user-text:${input.messageId}`,
      kind: 'user_text',
      text: input.text,
      format: 'plain',
    }],
  };
}

function assistantMessage(input: {
  messageId: string;
  runId: string;
  text: string;
}): TimelineAssistantMessage {
  return {
    messageId: input.messageId,
    role: 'assistant',
    projectId: 'workspace-1',
    sessionId: 'session-1',
    runId: input.runId,
    createdAt: '2026-07-09T03:13:25.326Z',
    blocks: [{
      blockId: `answer:${input.messageId}`,
      kind: 'answer_text',
      runId: input.runId,
      textId: `text:${input.messageId}`,
      status: 'completed',
      text: input.text,
      format: 'markdown',
    }],
  };
}
