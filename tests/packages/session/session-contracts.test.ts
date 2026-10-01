import { describe, expect, it } from 'vitest';
import {
  SessionAssistantReplyPayloadSchema,
  SessionMessageSchema,
  SessionModelResponsePayloadSchema,
} from '../../../packages/agent/session/src/index';
import type {
  SessionMessage
} from '../../../packages/agent/session/src/index';

describe('session contracts v2', () => {
  it('accepts a user message with display and model content', () => {
    const message: SessionMessage = {
      message_id: 'message:1',
      session_id: 'session:1',
      message_kind: 'user_message',
      display_content: [{ type: 'text', text: 'hello' }], model_content: [{ type: 'text', text: 'hello' }],
      created_at: '2026-07-04T00:00:00.000Z',
      completed_at: '2026-07-04T00:00:00.000Z',
    };

    expect(SessionMessageSchema.parse(message)).toEqual(message);

  });

  it('accepts Model Response and Assistant Reply payloads without duplicate discriminators', () => {
    expect(SessionModelResponsePayloadSchema.parse({
      content: [
        { type: 'thinking', thinking: 'inspect first' },
        { type: 'text', text: 'Checking.' },
        { type: 'toolCall', id: 'T1', name: 'read_file', arguments: { path: 'a.ts' } },
      ],
      outcome_status: 'completed',
      stop_reason: 'tool_use',
    })).toMatchObject({ outcome_status: 'completed', stop_reason: 'tool_use' });

    expect(SessionAssistantReplyPayloadSchema.parse({
      status: 'completed',
      content: [{ type: 'text', text: 'Done.' }],
      reason_code: 'normal_completion',
    })).toMatchObject({ status: 'completed' });

    for (const forbidden of [
      { usage: { input_tokens: 1 } },
      { error: { code: 'provider_error' } },
      { sequence: 2 },
      { requestId: 'request:1' },
      { role: 'assistant' },
      { kind: 'assistant_reply' },
      { replyToMessageId: 'message:user' },
      { providerId: 'provider:1' },
    ]) {
      expect(SessionAssistantReplyPayloadSchema.safeParse({
        status: 'completed',
        content: [{ type: 'text', text: 'reply' }],
        ...forbidden,
      }).success).toBe(false);
    }
  });

  it('rejects completed replies without visible text and every reply containing Work Tool Calls', () => {
    expect(SessionAssistantReplyPayloadSchema.safeParse({
      status: 'completed',
      content: [{ type: 'thinking', thinking: 'still working' }],
    }).success).toBe(false);
    expect(SessionAssistantReplyPayloadSchema.safeParse({
      status: 'failed',
      content: [{ type: 'toolCall', id: 'T1', name: 'read_file', arguments: {} }],
    }).success).toBe(false);
    expect(SessionAssistantReplyPayloadSchema.safeParse({
      status: 'cancelled',
      content: [],
      reason_code: 'user_cancelled',
    }).success).toBe(true);
  });
});
