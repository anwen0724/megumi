import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RUN_ACTION_KINDS,
  RunActionKindSchema,
  RunActionSchema,
  RunObservationSchema,
  RunObservationSourceSchema,
  RunSchema,
  RunStatusSchema,
  RunStepKindSchema,
  RunStepSchema,
  SessionMessageSchema,
  SessionSchema,
  type RunActionId,
  type RunObservationId,
  type RunStepId,
} from '@megumi/shared/session-run-contracts';

const now = '2026-05-15T00:00:00.000Z';

describe('session run contracts', () => {
  it('exports branded run ids through the contract module', () => {
    const stepId = 'step-1' as RunStepId;
    const actionId = 'action-1' as RunActionId;
    const observationId = 'observation-1' as RunObservationId;

    expect(stepId).toBe('step-1');
    expect(actionId).toBe('action-1');
    expect(observationId).toBe('observation-1');
  });

  it('defines lifecycle status and kind schemas from the 02 spec', () => {
    expect(RunStatusSchema.options).toEqual([
      'queued',
      'running',
      'waiting_for_approval',
      'paused',
      'cancelling',
      'cancelled',
      'failed',
      'completed',
    ]);
    expect(RunStepKindSchema.options).toContain('observation');
    expect(RunActionKindSchema.options).toEqual([
      'emit_message',
      'create_artifact',
      'update_context',
      'update_memory',
      'save_checkpoint',
      'recover',
      'cancel',
    ]);
    expect(RunActionKindSchema.options).not.toContain('plan');
    expect(RunObservationSourceSchema.options).toContain('runtime');
  });

  it('keeps RunAction kinds for Host maintenance only', () => {
    expect(RUN_ACTION_KINDS).toEqual([
      'emit_message',
      'create_artifact',
      'update_context',
      'update_memory',
      'save_checkpoint',
      'recover',
      'cancel',
    ]);
    expect(RUN_ACTION_KINDS).not.toContain('call_tool');
    expect(RUN_ACTION_KINDS).not.toContain('request_approval');
  });

  it('validates the minimum Session shape strictly', () => {
    const parsed = SessionSchema.parse({
      sessionId: 'session-1',
      title: 'Megumi session',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    expect(parsed.sessionId).toBe('session-1');
    expect(() => SessionSchema.parse({ ...parsed, extra: true })).toThrow();
  });

  it('validates SessionMessage without replacing Run or RuntimeEvent', () => {
    expect(SessionMessageSchema.parse({
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

  it('validates Run, RunStep, RunAction, and RunObservation relationships', () => {
    expect(RunSchema.parse({
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

    expect(RunStepSchema.parse({
      stepId: 'step-1',
      runId: 'run-1',
      kind: 'model',
      status: 'pending',
    })).toMatchObject({
      kind: 'model',
    });

    expect(RunActionSchema.parse({
      actionId: 'action-1',
      runId: 'run-1',
      stepId: 'step-1',
      kind: 'emit_message',
      status: 'requested',
      requestedAt: now,
    })).toMatchObject({
      kind: 'emit_message',
    });

    expect(RunObservationSchema.parse({
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

  it('uses permissionSnapshotRef as the only permission snapshot domain field', () => {
    expect(RunSchema.parse({
      runId: 'run:1',
      sessionId: 'session:1',
      mode: 'plan',
      permissionSnapshotRef: 'permission-snapshot:1',
      goal: 'Review changes',
      status: 'running',
      createdAt: '2026-06-11T00:00:00.000Z',
    }).permissionSnapshotRef).toBe('permission-snapshot:1');

    expect(() => RunSchema.parse({
      runId: 'run:1',
      sessionId: 'session:1',
      mode: 'plan',
      modeSnapshotRef: 'mode-snapshot:legacy',
      goal: 'Review changes',
      status: 'running',
      createdAt: '2026-06-11T00:00:00.000Z',
    })).toThrow();
  });

  it('uses session and run as the primary shared lifecycle names', () => {
    expect(SessionSchema.parse({
      sessionId: 'session-1',
      title: 'Megumi session',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).sessionId).toBe('session-1');

    expect(RunSchema.parse({
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'chat',
      goal: 'Answer the user',
      status: 'queued',
      createdAt: now,
    }).status).toBe('queued');
  });

  it('does not declare old agent lifecycle names as primary contracts', () => {
    const source = readFileSync('packages/shared/session-run-contracts.ts', 'utf8');

    expect(source).not.toMatch(/interface AgentSession/);
    expect(source).not.toMatch(/interface Message/);
    expect(source).not.toMatch(/interface AgentRun/);
    expect(source).not.toMatch(/interface AgentStep/);
    expect(source).not.toMatch(/interface AgentAction/);
    expect(source).not.toMatch(/interface AgentObservation/);
    expect(source).not.toMatch(/const AGENT_/);
  });
});
