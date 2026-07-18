import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('Product Host public seam', () => {
  it('does not wildcard re-export Agent internals from the Host barrel', () => {
    const source = readFileSync(join(root, 'packages/product/host-interface/index.ts'), 'utf8');

    expect(source).not.toContain("export type * from '../../agent/");
    expect(source).not.toContain("export * from '../../agent/");
    expect(source).not.toContain('reduceRuntimeTimelineEvent');
    expect(source).not.toContain('createRuntimeContext as buildRuntimeContext');
    expect(source).not.toContain('normalizeRuntimeError as normalizeHostRuntimeError');
  });

  it('keeps runtime protocol wrappers outside the Host barrel', () => {
    const runtimeEvents = readFileSync(join(root, 'packages/product/runtime-events/index.ts'), 'utf8');
    const runtimeTimeline = readFileSync(join(root, 'packages/product/runtime-timeline/index.ts'), 'utf8');

    expect(runtimeEvents).toContain('buildRuntimeContext');
    expect(runtimeEvents).toContain('RuntimeEventSchema');
    expect(runtimeTimeline).toContain('reduceRuntimeTimelineEvent');
  });

  it('does not expose owner record aliases from ArtifactHost or PlanHost', () => {
    const artifactHost = readFileSync(join(root, 'packages/product/host-interface/artifact-host.ts'), 'utf8');
    const planHost = readFileSync(join(root, 'packages/product/host-interface/plan-host.ts'), 'utf8');

    expect(artifactHost).not.toContain('export type ArtifactRecord = Artifact');
    expect(artifactHost).not.toContain('export type ArtifactVersionRecord = ArtifactVersion');
    expect(artifactHost).not.toContain('export type ArtifactSourceRefRecord = ArtifactSourceRef');
    expect(planHost).not.toContain('OwnerImplementationPlanArtifactRecord');
  });
});
