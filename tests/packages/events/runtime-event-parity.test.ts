/*
 * Protects complete runtime event envelope and schema migration parity.
 */
import { describe, expect, it } from 'vitest';
import {
  RUNTIME_EVENT_TYPES,
  RUNTIME_EVENT_ENVELOPE_TYPES,
  RUNTIME_EVENT_SCHEMAS_BY_TYPE,
  RuntimeEventSchema,
  type RuntimeEvent,
} from '../../../packages/events/src/index';

const EXPECTED_RUNTIME_EVENT_ENVELOPE_TYPES = [
  'session.created', 'session.updated', 'session.active_leaf.changed', 'session.branch_marker.created',
  'session.branch_draft.cancelled', 'run.created', 'run.started', 'run.status.changed', 'run.completed',
  'run.failed', 'run.cancelled', 'run.interrupted', 'run.waiting', 'run.plan.updated', 'observation.received',
  'context.patch.requested', 'context.patch.applied', 'context.patch.rejected', 'context.effective.updated',
  'context.compaction.started', 'context.compaction.completed', 'context.compaction.failed', 'message.delta',
  'message.completed', 'error.raised', 'assistant.output.delta', 'assistant.output.completed',
  'model_call.started', 'model_call.text_delta', 'model_call.projection_reset', 'model_call.completed',
  'model_call.tool_call', 'model.thinking.started', 'model.thinking.delta', 'model.thinking.completed',
  'model.tool_call.detected', 'tool_call.requested', 'tool_call.started', 'tool_call.completed',
  'tool_call.failed', 'tool.call.created', 'tool.call.resolved', 'tool.call.resolution_failed',
  'tool.input.validation_failed', 'tool_result.created', 'tool.result.created', 'tool.registry.sources.ensured',
  'tool.registry.snapshot.created', 'tool.registry.entry.resolved', 'tool.registry.model_visible_tools.derived',
  'tool.execution.requested', 'tool.execution.validated', 'tool.execution.decided', 'tool.execution.queued',
  'tool.execution.rejected', 'tool.execution.cancelled', 'tool.execution.policy_decided',
  'permission.decision.created', 'tool.execution.approval_requested', 'tool.execution.started', 'tool.execution.output',
  'tool.execution.routed', 'tool.execution.completed', 'tool.execution.failed', 'tool.execution.denied',
  'tool.observation.ready', 'tool.continuation.ready', 'tool.continuation.emitted', 'approval.requested',
  'approval.resolved', 'approval.expired', 'checkpoint.created', 'checkpoint.restored',
  'checkpoint.invalidated', 'checkpoint.discarded', 'run.resume.requested', 'run.resumed',
  'run.resume.failed', 'run.cancel.requested', 'run.cancelling', 'action.cancelled',
  'run.retry.requested', 'action.retry.requested', 'retry.started', 'retry.completed', 'retry.failed',
  'workspace.restore.requested', 'workspace.restore.completed', 'action.requested',
] as const;

function event(
  eventType: RuntimeEvent['eventType'],
  payload: Record<string, unknown>,
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return {
    eventId: `event:${eventType.replaceAll('.', '_')}:1`,
    schemaVersion: 1,
    eventType,
    runId: 'run:1',
    sessionId: 'session:1',
    requestId: 'request:1',
    sequence: 1,
    createdAt: '2026-07-09T00:00:00.000Z',
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload,
    ...overrides,
  };
}

describe('runtime event envelope parity', () => {
  it('keeps every legacy envelope type and an explicit runtime schema', () => {
    expect(RUNTIME_EVENT_ENVELOPE_TYPES).toEqual(EXPECTED_RUNTIME_EVENT_ENVELOPE_TYPES);
    expect(Object.keys(RUNTIME_EVENT_SCHEMAS_BY_TYPE).sort()).toEqual(
      [...EXPECTED_RUNTIME_EVENT_ENVELOPE_TYPES].sort(),
    );
  });

  it('retains the host-maintenance action.requested envelope', () => {
    expect(RuntimeEventSchema.safeParse(event('action.requested', {
      kind: 'host_maintenance',
      status: 'requested',
      inputPreview: { reason: 'refresh' },
    })).success).toBe(true);
  });

  it('accepts model-call and tool-result events with optional user-facing summaries', () => {
    expect(RuntimeEventSchema.safeParse(event('model_call.text_delta', {
      modelCallId: 'model-call:1', delta: 'hello',
    })).success).toBe(true);
    expect(RuntimeEventSchema.safeParse(event('tool_result.created', {
      toolCallId: 'tool-call:1', toolName: 'read_file', kind: 'success',
      content: [{ type: 'text', text: 'done' }],
    })).success).toBe(true);
    expect(RuntimeEventSchema.safeParse(event('tool_result.created', {
      toolCallId: 'tool-call:1', toolName: 'read_file', kind: 'success',
      content: [{ type: 'text', text: 'done' }], summary: 'read_file completed',
    })).success).toBe(true);
    expect(RuntimeEventSchema.safeParse(event('tool_result.created', {
      toolCallId: 'tool-call:1', toolExecutionId: 'tool-call:1', toolName: 'read_file',
      kind: 'failure', content: [{ type: 'text', text: 'failed' }],
      error: { code: 'tool_execution_failed', message: 'Tool execution failed.' },
    })).success).toBe(false);
  });

  it('normalizes legacy model completion text into content blocks', () => {
    const parsed = RuntimeEventSchema.parse(event('model_call.completed', {
      modelCallId: 'model-call:1', finishReason: 'stop', content: 'done',
    }));
    expect(parsed.payload).toMatchObject({ content: [{ type: 'text', text: 'done' }] });
  });

  it('accepts session compaction with or without a causative run but requires a session', () => {
    const payload = {
      compactionId: 'compaction:1', triggerReason: 'automatic', tokensBefore: 240000,
      firstKeptSourceRef: { sourceId: 'message:1', sourceKind: 'message' }, summarizedSourceCount: 12,
    };
    expect(RuntimeEventSchema.safeParse(event('context.compaction.started', payload, { runId: undefined })).success).toBe(true);
    expect(RuntimeEventSchema.safeParse(event('context.compaction.started', payload)).success).toBe(true);
    expect(RuntimeEventSchema.safeParse(event('context.compaction.started', payload, { runId: undefined, sessionId: undefined })).success).toBe(false);
    expect(RuntimeEventSchema.safeParse(event('context.compaction.completed', {
      ...payload, readFiles: ['README.md'], modifiedFiles: ['src/index.ts'],
    }, { runId: undefined })).success).toBe(true);
    expect(RuntimeEventSchema.safeParse(event('context.compaction.failed', {
      triggerReason: 'automatic', tokensBefore: 240000,
      error: { code: 'runtime_unknown', message: 'Compaction failed.', severity: 'error', retryable: false, source: 'core' },
    }, { runId: undefined })).success).toBe(true);
  });

  it('keeps V2 run waiting states without fabricated execution identities', () => {
    expect(RuntimeEventSchema.safeParse(event('run.status.changed', { from: 'running', to: 'waiting' })).success).toBe(true);
    expect(RuntimeEventSchema.safeParse(event('run.waiting', {
      approvalRequestId: 'approval:1', toolCallId: 'tool-call:1', reason: 'approval_required',
    })).success).toBe(true);
    expect(RuntimeEventSchema.safeParse(event('run.waiting', {
      approvalRequestId: 'approval:1', toolCallId: 'tool-call:1', toolExecutionId: 'tool-call:1', reason: 'approval_required',
    })).success).toBe(false);
  });

  it('enforces the canonical approval event serialization contract', () => {
    const approvalRequest = {
      approvalRequest: {
        approvalRequestId: 'approval:1',
        runId: 'run:1',
        toolCallId: 'tool-call:1',
        toolName: 'write_file',
        toolIdentity: {
          sourceId: 'built-in',
          namespace: 'megumi',
          sourceToolName: 'write_file',
        },
        input: { path: 'README.md' },
        operations: [],
        options: [{
          optionId: 'once:tool-call:1',
          scope: 'once',
          display: { label: 'Once', description: 'Allow this call.' },
          effect: { type: 'current_tool_call' },
        }],
        defaultOptionId: 'once:tool-call:1',
        status: 'pending',
        createdAt: '2026-07-31T00:00:00.000Z',
      },
    };
    expect(RuntimeEventSchema.safeParse(event('approval.requested', approvalRequest)).success).toBe(true);
    expect(RuntimeEventSchema.safeParse(event('approval.requested', {
      approval_request: approvalRequest.approvalRequest,
    })).success).toBe(false);
    expect(RuntimeEventSchema.safeParse(event('approval.requested', {
      approvalRequest: {
        approvalRequestId: 'approval:1',
        options: [{ optionId: 'once:tool-call:1' }],
        defaultOptionId: 'once:tool-call:1',
      },
    })).success).toBe(false);
  });

  it('rejects missing required payload fields and does not revive Step events', () => {
    expect(RuntimeEventSchema.safeParse(event('model_call.text_delta', { delta: 'hello' })).success).toBe(false);
    expect(RuntimeEventSchema.safeParse(event('tool_result.created', {
      kind: 'success', content: [{ type: 'text', text: 'done' }],
    })).success).toBe(false);
    expect(RUNTIME_EVENT_TYPES).not.toContain('step.created');
    expect(RUNTIME_EVENT_TYPES).not.toContain('model.step.started');
  });
});
