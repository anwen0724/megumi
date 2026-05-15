import { describe, expect, it } from 'vitest';
import {
  createContextPatchObservation,
  createContextUpdateInputPreview,
  isContextPatchObservation,
} from '@megumi/core/agent-runtime/context';
import type { ContextPatch } from '@megumi/shared/agent-context-contracts';

const patch: ContextPatch = {
  patchId: 'patch-1',
  runId: 'run-1',
  stepId: 'step-1',
  requestedBy: 'agent',
  operation: 'add',
  sourceRef: 'source-1',
  reason: 'Need shared context contracts.',
  createdAt: '2026-05-15T00:00:00.000Z',
  status: 'requested',
};

describe('agent runtime context helpers', () => {
  it('creates safe update_context input previews', () => {
    expect(createContextUpdateInputPreview(patch)).toEqual({
      patchId: 'patch-1',
      operation: 'add',
      requestedBy: 'agent',
      reason: 'Need shared context contracts.',
    });
  });

  it('creates context patch observations without raw content', () => {
    const observation = createContextPatchObservation({
      observationId: 'observation-1',
      patch: { ...patch, status: 'applied', appliedAt: '2026-05-15T00:00:01.000Z' },
      receivedAt: '2026-05-15T00:00:01.000Z',
      effectiveContextBuildId: 'build-1',
    });

    expect(observation).toMatchObject({
      kind: 'context_patch_applied',
      source: 'workspace',
      summary: 'Context patch add applied.',
    });
    expect(observation.metadata).toMatchObject({
      patchId: 'patch-1',
      effectiveContextBuildId: 'build-1',
    });
    expect(JSON.stringify(observation)).not.toContain('raw full prompt');
  });

  it('detects context patch observations', () => {
    const observation = createContextPatchObservation({
      observationId: 'observation-1',
      patch,
      receivedAt: '2026-05-15T00:00:01.000Z',
      rejectionReason: 'Source is blocked.',
    });

    expect(isContextPatchObservation(observation)).toBe(true);
    expect(isContextPatchObservation({
      ...observation,
      kind: 'message_emitted',
    })).toBe(false);
  });
});
