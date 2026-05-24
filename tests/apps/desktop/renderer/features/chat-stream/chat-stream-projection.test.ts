import { describe, expect, it } from 'vitest';
import { reduceChatStreamEvent as rendererReduceChatStreamEvent } from '@megumi/desktop/renderer/features/chat-stream/chat-stream-projection';
import { reduceChatStreamEvent as sharedReduceChatStreamEvent } from '@megumi/shared/chat-stream-to-timeline-projection';

describe('chat stream projection wrapper', () => {
  it('re-exports the shared reducer', () => {
    expect(rendererReduceChatStreamEvent).toBe(sharedReduceChatStreamEvent);
  });
});
