/* Verifies the preserved Artifact UI seam no longer reaches the removed backend. */
import { describe, expect, it } from 'vitest';
import { createUnavailableArtifactHost } from '@megumi/product/host-interface/artifact-host';

describe('createUnavailableArtifactHost', () => {
  it('returns empty read projections for the unchanged desktop UI', () => {
    const host = createUnavailableArtifactHost();

    expect(host.listByRun('run:1')).toEqual({ artifacts: [] });
    expect(host.listBySession('session:1')).toEqual({ artifacts: [] });
    expect(host.get('artifact:1')).toEqual({
      artifact: undefined,
      currentVersion: undefined,
      sourceRefs: [],
    });
    expect(host.getVersion('version:1')).toEqual({ version: undefined });
  });

  it('rejects write operations while no Artifact backend exists', async () => {
    const host = createUnavailableArtifactHost();
    await expect(host.createVersion({} as never)).rejects.toThrow('Artifact backend is unavailable.');
    expect(() => host.updateStatus({} as never)).toThrow('Artifact backend is unavailable.');
    expect(() => host.reference({} as never)).toThrow('Artifact backend is unavailable.');
  });
});
