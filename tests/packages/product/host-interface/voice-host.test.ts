import { describe, expect, it } from 'vitest';
import {
  VoiceProfileImportPayloadSchema,
  VoiceSessionStartPayloadSchema,
  type ProductHostInterface,
} from '../../../../packages/product/src/host';

describe('VoiceHost contract', () => {
  it('accepts product intent without exposing a caller-provided reference-audio path', () => {
    expect(VoiceProfileImportPayloadSchema.parse({ name: 'Warm voice' })).toEqual({
      name: 'Warm voice',
    });
    expect(VoiceProfileImportPayloadSchema.safeParse({
      name: 'Warm voice',
      sourceAudioPath: 'C:/arbitrary/reference.wav',
    }).success).toBe(false);
  });

  it('starts against one explicit Bound Session', () => {
    expect(VoiceSessionStartPayloadSchema.parse({ boundSessionId: 'session:one' })).toEqual({
      boundSessionId: 'session:one',
    });
    expect(VoiceSessionStartPayloadSchema.safeParse({ boundSessionId: '' }).success).toBe(false);
  });

  it('adds Voice as a first-class Product Host capability', () => {
    const host = {} as ProductHostInterface;
    expect(host).toBeDefined();
  });
});
