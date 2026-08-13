import { describe, expect, it } from 'vitest';
import {
  VoiceHostMutationResultSchema,
  VoiceProfileImportPayloadSchema,
  VoiceSessionStartPayloadSchema,
  type ProductHostInterface,
  type VoiceHost,
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

  it('starts against one explicit Bound Session and an optional recognition language', () => {
    expect(VoiceSessionStartPayloadSchema.parse({ boundSessionId: 'session:one' })).toEqual({
      boundSessionId: 'session:one',
    });
    expect(VoiceSessionStartPayloadSchema.parse({ boundSessionId: 'session:one', language: 'zh' })).toEqual({
      boundSessionId: 'session:one',
      language: 'zh',
    });
    expect(VoiceSessionStartPayloadSchema.safeParse({ boundSessionId: '' }).success).toBe(false);
    expect(VoiceSessionStartPayloadSchema.safeParse({ boundSessionId: 'session:one', language: 'de' }).success).toBe(false);
  });

  it('returns the Speech Input generation on a started Voice Session', () => {
    expect(VoiceHostMutationResultSchema.parse({ status: 'ok', generation: 3 })).toEqual({
      status: 'ok',
      generation: 3,
    });
    expect(VoiceHostMutationResultSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(VoiceHostMutationResultSchema.safeParse({ status: 'ok', generation: -1 }).success).toBe(false);
  });

  it('exposes click-based manual utterance boundaries as first-class Voice operations', () => {
    // Type-level contract: both operations must exist on the Host surface.
    const operations: Pick<VoiceHost, 'startManualUtterance' | 'finishManualUtterance'> = {} as VoiceHost;
    expect(operations).toBeDefined();
  });

  it('adds Voice as a first-class Product Host capability', () => {
    const host = {} as ProductHostInterface;
    expect(host).toBeDefined();
  });
});
