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

  it('projects owner artifact records into independent host DTOs', () => {
    const ownerArtifact = {
      artifactId: 'artifact:1',
      kind: 'implementation_plan' as const,
      title: 'Plan',
      status: 'active' as const,
      producingRunId: 'run:1',
      currentVersionId: 'version:1',
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
      metadata: { extra: true },
      ownerOnlyField: 'must not cross',
    };
    const host = createArtifactHost({
      listByRun: vi.fn(() => [ownerArtifact]),
      listBySession: vi.fn(() => []),
      get: vi.fn(),
      getVersion: vi.fn(),
      createVersion: vi.fn(),
      updateStatus: vi.fn(),
      reference: vi.fn(),
    } as never);

    expect(host.listByRun('run:1')).toEqual({
      artifacts: [{
        artifactId: 'artifact:1',
        kind: 'implementation_plan',
        title: 'Plan',
        status: 'active',
        producingRunId: 'run:1',
        currentVersionId: 'version:1',
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
        metadata: { extra: true },
      }],
    });
  });
});
