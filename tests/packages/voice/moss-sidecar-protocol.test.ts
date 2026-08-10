import { describe, expect, it } from 'vitest';
import { validateMossSidecarReadyMessage } from '../../../packages/voice/src/moss-sidecar';

describe('MOSS sidecar protocol handshake', () => {
  it('rejects an old sidecar before sending a synthesis request', () => {
    expect(() => validateMossSidecarReadyMessage({ type: 'ready' })).toThrow(
      /protocol version/i,
    );
  });

  it('accepts the current protocol version', () => {
    expect(() => validateMossSidecarReadyMessage({ type: 'ready', protocolVersion: 2 })).not.toThrow();
  });
});
