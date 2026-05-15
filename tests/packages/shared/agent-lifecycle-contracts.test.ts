import { describe, expect, it } from 'vitest';
import { AgentSessionSchema as RootAgentSessionSchema } from '@megumi/shared';
import {
  AgentActionKindSchema,
  AgentActionSchema,
  AgentObservationSchema,
  AgentRunSchema,
  AgentRunStatusSchema,
  AgentSessionSchema,
  AgentStepKindSchema,
  AgentStepSchema,
  MessageSchema,
  type AgentActionId,
  type AgentObservationId,
  type AgentStepId,
} from '@megumi/shared/agent-lifecycle-contracts';

const now = '2026-05-15T00:00:00.000Z';

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
      createdAt: now,
      updatedAt: now,
    });

    expect(parsed.sessionId).toBe('session-1');
    expect(RootAgentSessionSchema.parse(parsed).sessionId).toBe('session-1');
    expect(() => AgentSessionSchema.parse({ ...parsed, extra: true })).toThrow();
  });

  it('validates Message without replacing AgentRun or RuntimeEvent', () => {
    expect(MessageSchema.parse({
      messageId: 'message-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Hello',
      status: 'completed',
      createdAt: now,
      completedAt: now,
    })).toMatchObject({
      role: 'assistant',
      runId: undefined,
    });
  });

  it('validates AgentRun, AgentStep, AgentAction, and AgentObservation relationships', () => {
    expect(AgentRunSchema.parse({
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'chat',
      goal: 'Answer the user',
      status: 'queued',
      createdAt: now,
    })).toMatchObject({
      runId: 'run-1',
      status: 'queued',
    });

    expect(AgentStepSchema.parse({
      stepId: 'step-1',
      runId: 'run-1',
      kind: 'model',
      status: 'pending',
    })).toMatchObject({
      kind: 'model',
    });

    expect(AgentActionSchema.parse({
      actionId: 'action-1',
      runId: 'run-1',
      stepId: 'step-1',
      kind: 'emit_message',
      status: 'requested',
      requestedAt: now,
    })).toMatchObject({
      kind: 'emit_message',
    });

    expect(AgentObservationSchema.parse({
      observationId: 'observation-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionId: 'action-1',
      source: 'runtime',
      kind: 'message_emitted',
      receivedAt: now,
      summary: 'Assistant message emitted',
    })).toMatchObject({
      source: 'runtime',
    });
  });
});
