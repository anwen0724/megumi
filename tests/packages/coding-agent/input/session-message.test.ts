import { describe, expect, it } from 'vitest';

import {
  parseSessionMessageRawInput,
  prepareSessionMessageInput,
} from '@megumi/coding-agent/input';
import type { SessionMessageSendPayload } from '@megumi/shared/ipc';

describe('session message input', () => {
  it('uses the explicit current message when present and normalizes preprocessing', () => {
    const prepared = prepareSessionMessageInput({
      payload: createPayload({
        message: {
          id: 'client-message-1',
          content: 'Review this change',
          createdAt: '2026-06-29T01:00:00.000Z',
        },
        context: {
          permissionMode: 'accept_edits',
          permissionSource: 'user',
        },
      }),
    });

    expect(prepared.currentUserMessage.content).toBe('Review this change');
    expect(prepared.permissionMode).toBe('accept_edits');
    expect(prepared.permissionSource).toBe('user');
    expect(prepared.inputPreprocessing.effectiveUserText).toBe('Review this change');
    expect(prepared.inputPreprocessing.entries).toContainEqual(expect.objectContaining({
      kind: 'input_hook',
      hookId: 'default',
    }));
  });

  it('falls back to the last user history message', () => {
    const prepared = prepareSessionMessageInput({
      payload: createPayload({
        message: undefined,
        messages: [
          {
            id: 'assistant-message-1',
            role: 'assistant',
            content: 'Previous answer',
            createdAt: '2026-06-29T01:00:00.000Z',
          },
          {
            id: 'user-message-2',
            role: 'user',
            content: '/review src/index.ts',
            createdAt: '2026-06-29T01:01:00.000Z',
          },
        ],
      }),
    });

    expect(prepared.currentUserMessage).toEqual({
      id: 'user-message-2',
      content: '/review src/index.ts',
      createdAt: '2026-06-29T01:01:00.000Z',
    });
  });

  it('throws when no user message is available', () => {
    expect(() => prepareSessionMessageInput({
      payload: createPayload({
        message: undefined,
        messages: [{
          id: 'assistant-message-1',
          role: 'assistant',
          content: 'No user input',
          createdAt: '2026-06-29T01:00:00.000Z',
        }],
      }),
    })).toThrow('Session message send requires a user message.');
  });

  it('parses session message raw input with an explicit command fact from Command Service', () => {
    const parsed = parseSessionMessageRawInput({
      requestId: 'request-1',
      runId: 'run-1',
      sessionId: 'session-1',
      message: {
        id: 'client-message-1',
        content: '/review packages/coding-agent',
        createdAt: '2026-06-29T01:00:00.000Z',
      },
      createdAt: '2026-06-29T01:00:00.000Z',
      command: {
        name: 'review',
        source: { kind: 'built_in' },
        arguments_input: 'packages/coding-agent',
      },
    });

    expect(parsed.rawInputId).toBe('raw-input:run-1:client-message-1');
    expect(parsed.target).toEqual({
      kind: 'session',
      sessionId: 'session-1',
    });
    expect(parsed.metadata).toEqual({ requestId: 'request-1' });
    expect(parsed.facts).toEqual([{
      kind: 'command',
      name: 'review',
      source: { kind: 'built_in' },
      arguments_input: 'packages/coding-agent',
      raw_input: '/review packages/coding-agent',
    }]);
  });
});

function createPayload(overrides: Partial<SessionMessageSendPayload> = {}): SessionMessageSendPayload {
  return {
    createdAt: '2026-06-29T01:00:00.000Z',
    providerId: 'openai',
    modelId: 'gpt-4.1',
    message: {
      id: 'client-message-1',
      content: 'Hello',
      createdAt: '2026-06-29T01:00:00.000Z',
    },
    messages: [],
    ...overrides,
  };
}
