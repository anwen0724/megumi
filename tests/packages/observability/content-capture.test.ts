// @vitest-environment node
/* Verifies safe, deterministic capture of diagnostic content. */
import { describe, expect, it } from 'vitest';
import { captureContent } from '../../../packages/agent/observability/src/content/content-capture';

describe('Content capture', () => {
  it('redacts credential-like query parameters inside Source URLs', () => {
    const captured = captureContent({
      value: 'https://www.xiaohongshu.com/explore/item?xsec_token=provider-secret&mode=search',
    });

    expect(captured.content).toMatchObject({
      mode: 'inline',
      value: 'https://www.xiaohongshu.com/explore/item?xsec_token=[redacted]&mode=search',
    });
  });

  it('canonicalizes object keys and redacts secret fields before hashing', () => {
    const first = captureContent({
      value: {
        visible: 'ordinary text',
        nested: { token: 'must-never-appear', answer: 42, inputTokens: 128 },
      },
    });
    const second = captureContent({
      value: {
        nested: { inputTokens: 128, answer: 42, token: 'different-secret' },
        visible: 'ordinary text',
      },
    });

    expect(first.content).toEqual(second.content);
    expect(first.content).toMatchObject({
      mode: 'inline',
      mediaType: 'application/json',
      value: {
        nested: { answer: 42, inputTokens: 128, token: null },
        visible: 'ordinary text',
      },
      issues: [{ path: '/nested/token', kind: 'redacted', reason: 'secret_field' }],
    });
    expect(JSON.stringify(first)).not.toContain('must-never-appear');
    expect(JSON.stringify(second)).not.toContain('different-secret');
  });

  it('keeps exactly 16 KiB of safe UTF-8 text inline and stores the next byte', () => {
    const atBoundary = captureContent({ value: 'a'.repeat(16 * 1024) });
    const aboveBoundary = captureContent({ value: 'a'.repeat((16 * 1024) + 1) });

    expect(atBoundary.content.mode).toBe('inline');
    expect(aboveBoundary.content).toMatchObject({
      mode: 'stored',
      mediaType: 'text/plain;charset=utf-8',
      byteLength: (16 * 1024) + 1,
    });
    expect(aboveBoundary.storedBytes).toHaveLength((16 * 1024) + 1);
  });

  it('does not invoke accessors and marks unsafe nested values at JSON Pointer paths', () => {
    let getterCalls = 0;
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const source = {
      circular,
      functionValue: () => 'must-not-run',
      infinity: Number.POSITIVE_INFINITY,
      symbolValue: Symbol('diagnostic'),
      get dangerous() {
        getterCalls += 1;
        return 'must-not-read';
      },
      'path/with~marks': BigInt(1),
    };

    const captured = captureContent({ value: source });

    expect(getterCalls).toBe(0);
    expect(captured.content).toMatchObject({
      mode: 'inline',
      value: {
        circular: { self: null },
        dangerous: null,
        functionValue: null,
        infinity: null,
        symbolValue: null,
        'path/with~marks': null,
      },
    });
    if (captured.content.mode !== 'inline') {
      throw new Error('Expected inline diagnostic content.');
    }
    expect(captured.content.issues).toEqual(expect.arrayContaining([
      { path: '/circular/self', kind: 'unavailable', reason: 'circular_reference' },
      { path: '/dangerous', kind: 'unavailable', reason: 'unsafe_property_access' },
      { path: '/path~1with~0marks', kind: 'unavailable', reason: 'unsupported_value' },
    ]));
  });

  it('redacts content that consists entirely of a known credential pattern', () => {
    const captured = captureContent({ value: 'sk-secretvalue123456' });

    expect(captured).toEqual({
      content: { mode: 'redacted', reason: 'secret_pattern' },
    });
    expect(JSON.stringify(captured)).not.toContain('secretvalue');
  });

  it('always stores binary content and gives equal bytes the same identity', () => {
    const source = new Uint8Array([0, 1, 2, 255]);
    const fromView = captureContent({ value: source, mediaType: 'image/png' });
    const fromBuffer = captureContent({ value: source.buffer, mediaType: 'image/png' });
    source[0] = 99;

    expect(fromView.content).toEqual(fromBuffer.content);
    expect(fromView.content).toMatchObject({
      mode: 'stored',
      mediaType: 'image/png',
      byteLength: 4,
    });
    expect(fromView.storedBytes).toEqual(new Uint8Array([0, 1, 2, 255]));
  });

  it('marks a top-level value unavailable when even safe traversal is impossible', () => {
    const inaccessible = new Proxy({}, {
      ownKeys: () => { throw new Error('must-not-escape'); },
    });

    expect(captureContent({ value: inaccessible })).toEqual({
      content: { mode: 'unavailable', reason: 'unsafe_property_access' },
    });
  });

  it('captures arrays while enforcing depth, node, and plain-object limits', () => {
    expect(captureContent({ value: ['text', 2, true, null] }).content).toMatchObject({
      mode: 'inline',
      value: ['text', 2, true, null],
    });
    expect(captureContent({ value: new Date('2026-08-26T00:00:00.000Z') })).toEqual({
      content: { mode: 'unavailable', reason: 'unsupported_value' },
    });

    const depthLimited = captureContent({ value: { a: { b: 'too deep' } }, maxDepth: 1 });
    const nodeLimited = captureContent({ value: { a: 1, b: 2 }, maxNodes: 2 });
    const oversizedArray = captureContent({ value: new Array(100).fill('x'), maxNodes: 10 });

    expect(depthLimited.content).toMatchObject({
      mode: 'inline',
      value: { a: { b: null } },
      issues: [{ path: '/a/b', kind: 'unavailable', reason: 'serialization_failed' }],
    });
    expect(nodeLimited.content).toMatchObject({
      mode: 'inline',
      value: { a: 1, b: null },
      issues: [{ path: '/b', kind: 'unavailable', reason: 'serialization_failed' }],
    });
    expect(oversizedArray).toEqual({
      content: { mode: 'unavailable', reason: 'serialization_failed' },
    });
  });

  it('removes known credentials while preserving ordinary prompt and usage text', () => {
    const captured = captureContent({
      value: {
        authorization: 'Bearer authorization-secret',
        cookie: 'session=cookie-secret',
        password: 'password-secret',
        openaiApiKey: 'api-key-secret',
        token: 'token-secret',
        inputTokens: 256,
        rawPrompt: 'I forgot my password yesterday; help me rotate credentials.',
        providerMessage: 'Authorization: Bearer provider-secret-value',
      },
    });
    const serialized = JSON.stringify(captured);

    expect(serialized).not.toContain('authorization-secret');
    expect(serialized).not.toContain('cookie-secret');
    expect(serialized).not.toContain('password-secret');
    expect(serialized).not.toContain('api-key-secret');
    expect(serialized).not.toContain('token-secret');
    expect(serialized).not.toContain('provider-secret-value');
    expect(captured.content).toMatchObject({
      mode: 'inline',
      value: {
        inputTokens: 256,
        rawPrompt: 'I forgot my password yesterday; help me rotate credentials.',
        providerMessage: 'Authorization: [redacted]',
      },
    });
  });
});
