import { describe, expect, it } from 'vitest';
import { resolveCharacterState } from '@megumi/desktop/renderer/features/character-presence/character-state';

describe('resolveCharacterState', () => {
  it('maps real voice, run, approval, playback, and error facts by presentation priority', () => {
    expect(resolveCharacterState({ voiceStatus: 'listening' })).toBe('listening');
    expect(resolveCharacterState({ voiceStatus: 'thinking', activeTool: true })).toBe('acting');
    expect(resolveCharacterState({ voiceStatus: 'thinking', pendingApproval: true })).toBe('approval');
    expect(resolveCharacterState({ voiceStatus: 'thinking', pendingApproval: true, playing: true })).toBe('speaking');
    expect(resolveCharacterState({ voiceStatus: 'speaking', playing: true, error: true })).toBe('error');
  });

  it('does not invent an active state without an underlying fact', () => {
    expect(resolveCharacterState({ voiceStatus: 'idle' })).toBe('idle');
  });
});
