/* Provides shared model messages and input data for Context behavior tests. */
import { vi } from 'vitest';
import type { Api, AssistantMessage, Model } from '@megumi/ai';
import type { SessionHistoryItem } from '@megumi/session';
import type { CreateContextOptions } from '../../../packages/agent/context/src/index';

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
