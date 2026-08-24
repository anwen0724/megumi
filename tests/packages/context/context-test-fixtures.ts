/*
 * Supplies typed in-memory collaborators for public Context behavior tests:
 * the shared Model, ModelCallContext and history shapes used by both the
 * build and compaction test files.
 */
import { vi } from 'vitest';
import type { Api, AssistantMessage, Model } from '@megumi/ai';
import type { SessionHistoryItem } from '@megumi/session';
import type { CreateContextOptions, ModelCallContext, RunContext } from '../../../packages/agent/context/src/index';

export const model: Model<Api> = {
  id: 'gpt',
  name: 'GPT',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 20_000,
  maxTokens: 20,
};

/** Small-window Model for compaction tests that cross the threshold with tiny fixtures. */
export const compactingModel: Model<Api> = {
  ...model,
  reasoning: false,
  input: ['text'],
  contextWindow: 200,
};

export function completedMessage(content = 'summary'): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 0,
  };
}

export function history(): SessionHistoryItem[] {
  return [
    {
      type: 'message',
      entry: {
        entry_id: 'entry:user',
        session_id: 'session:1',
        entry_type: 'message',
        message_id: 'message:user',
        created_at: 'now',
      },
      message: {
        message_id: 'message:user',
        session_id: 'session:1',
        execution_id: 'run:old',
        message_kind: 'user_message',
        display_content: [{ type: 'text', text: 'before' }],
        model_content: [{ type: 'text', text: 'before' }],
        created_at: 'now',
      },
      attachments: [],
    },
    {
      type: 'message',
      entry: {
        entry_id: 'entry:assistant',
        session_id: 'session:1',
        parent_entry_id: 'entry:user',
        entry_type: 'message',
        message_id: 'message:assistant',
        created_at: 'now',
      },
      message: {
        message_id: 'message:assistant',
        session_id: 'session:1',
        execution_id: 'run:old',
        message_kind: 'assistant_reply',
        status: 'completed',
        content: [{ type: 'text', text: 'done' }],
        created_at: 'now',
      },
      attachments: [],
    },
  ];
}

export function runHistory(index: number): SessionHistoryItem[] {
  return [
    {
      type: 'message',
      entry: {
        entry_id: `entry:user:${index}`,
        session_id: 'session:1',
        ...(index > 1 ? { parent_entry_id: `entry:assistant:${index - 1}` } : {}),
        entry_type: 'message',
        message_id: `message:user:${index}`,
        created_at: 'now',
      },
      message: {
        message_id: `message:user:${index}`,
        session_id: 'session:1',
        execution_id: `run:${index}`,
        message_kind: 'user_message',
        display_content: [{ type: 'text', text: `question ${index}` }],
        model_content: [{ type: 'text', text: `question ${index}` }],
        created_at: 'now',
      },
      attachments: [],
    },
    {
      type: 'message',
      entry: {
        entry_id: `entry:assistant:${index}`,
        session_id: 'session:1',
        parent_entry_id: `entry:user:${index}`,
        entry_type: 'message',
        message_id: `message:assistant:${index}`,
        created_at: 'now',
      },
      message: {
        message_id: `message:assistant:${index}`,
        session_id: 'session:1',
        execution_id: `run:${index}`,
        message_kind: 'assistant_reply',
        status: 'completed',
        reason_code: 'normal_completion',
        content: [{ type: 'text', text: `answer ${index}` }],
        created_at: 'now',
        completed_at: 'now',
      },
      attachments: [],
    },
  ];
}

export function modelCall(overrides: Partial<ModelCallContext> = {}): ModelCallContext {
  const run: RunContext = {
    kind: 'conversation',
    executionId: 'run:current',
    sessionId: 'session:1',
    workspaceId: 'workspace:1',
    userInput: {
      displayContent: [{ type: 'text', text: 'now' }],
      modelContent: [{ type: 'text', text: 'now' }],
      attachments: [],
    },
    model,
  };
  return {
    modelCallId: 'model-call:1',
    run,
    tools: [],
    ...overrides,
  };
}

/** Default Workspace source resolution used by Context build/compaction tests. */
export function workspaceSource(): CreateContextOptions['workspaceSource'] {
  return {
    readWorkspace: vi.fn(async () => ({
      status: 'ok' as const,
      workspaceRoot: '/workspace',
      environment: {
        workingDirectory: '/workspace/packages/app',
        operatingSystem: 'Linux',
        shell: 'POSIX shell',
      },
    })),
  };
}
