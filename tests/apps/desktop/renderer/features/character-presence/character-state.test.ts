import { describe, expect, it } from 'vitest';
import { resolveCharacterState } from '@megumi/desktop/renderer/features/character-presence/character-state';

describe('resolveCharacterState', () => {
  it('maps real voice, run, and approval facts by presentation priority', () => {
    expect(resolveCharacterState({ voiceStatus: 'listening' })).toBe('listening');
    expect(resolveCharacterState({ voiceStatus: 'listening', activeTool: true })).toBe('acting');
    expect(resolveCharacterState({ voiceStatus: 'listening', pendingApproval: true })).toBe('approval');
    expect(resolveCharacterState({ voiceStatus: 'listening', error: true })).toBe('error');
  });

  it('does not invent an active state without an underlying fact', () => {
    expect(resolveCharacterState({ voiceStatus: 'idle' })).toBe('idle');
  });
});
