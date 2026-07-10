/*
 * Verifies ArtifactHost does not invent artifact facts that the owner did not return.
 */
import { describe, expect, it, vi } from 'vitest';
import { createArtifactHost } from '@megumi/product/host-interface/artifact-host';

describe('createArtifactHost', () => {
  it('does not fabricate relations when the artifact owner does not return them', () => {
    const host = createArtifactHost({
      listByRun: vi.fn(() => []),
      listBySession: vi.fn(() => []),
      get: vi.fn(() => ({ artifact: undefined, currentVersion: undefined, sourceRefs: [] })),
      getVersion: vi.fn(() => undefined),
      createVersion: vi.fn(),
      updateStatus: vi.fn(),
      reference: vi.fn(),
    });

    expect(host.get('artifact:1')).toEqual({
      artifact: undefined,
      currentVersion: undefined,
      sourceRefs: [],
    });
  });
});
