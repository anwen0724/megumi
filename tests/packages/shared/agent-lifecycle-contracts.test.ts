import { describe, expect, it } from 'vitest';
import {
  AgentRunStatusSchema,
  AgentStepKindSchema,
  AgentActionKindSchema,
  AgentSessionSchema,
  type AgentActionId,
  type AgentObservationId,
  type AgentStepId,
} from '@megumi/shared/agent-lifecycle-contracts';

describe('agent lifecycle contracts', () => {
  it('exports branded lifecycle ids through the contract module', () => {
    const stepId = 'step-1' as AgentStepId;
    const actionId = 'action-1' as AgentActionId;
    const observationId = 'observation-1' as AgentObservationId;

    expect(stepId).toBe('step-1');
    expect(actionId).toBe('action-1');
    expect(observationId).toBe('observation-1');
  });

  it('defines lifecycle status and kind schemas from the 02 spec', () => {
    expect(AgentRunStatusSchema.options).toEqual([
      'queued',
      'running',
      'waiting_for_approval',
      'paused',
      'cancelling',
      'cancelled',
      'failed',
      'completed',
    ]);
    expect(AgentStepKindSchema.options).toContain('observation');
    expect(AgentActionKindSchema.options).toEqual([
      'call_model',
      'call_tool',
      'request_approval',
      'emit_message',
      'create_artifact',
      'update_context',
      'update_memory',
      'save_checkpoint',
      'recover',
      'cancel',
    ]);
    expect(AgentActionKindSchema.options).not.toContain('plan');
  });

  it('validates the minimum AgentSession shape strictly', () => {
    const parsed = AgentSessionSchema.parse({
      sessionId: 'session-1',
      title: 'Megumi session',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });

    expect(parsed.sessionId).toBe('session-1');
    expect(() =>
      AgentSessionSchema.parse({
        ...parsed,
        extra: true,
      }),
    ).toThrow();
  });
});
