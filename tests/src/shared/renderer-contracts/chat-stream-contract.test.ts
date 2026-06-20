// Locks strict renderer chat stream event schemas consumed by src/ui dispatchers.
import { describe, expect, it } from 'vitest';
import { ChatStreamEventSchema } from '../../../../src/shared/renderer-contracts/chat-stream';

const base = {
  eventId: 'chat-event-1',
  projectId: 'project-1',
  sessionId: 'session-1',
  runId: 'run-1',
  streamId: 'chat-stream:run-1',
  streamKind: 'main',
  seq: 1,
  createdAt: '2026-06-20T00:00:00.000Z',
};

const approvalRequest = {
  approvalRequestId: 'approval-1',
  toolCallId: 'tool-call-1',
  toolExecutionId: 'tool-execution-1',
  permissionDecisionId: 'permission-decision-1',
  runId: 'run-1',
  stepId: 'step-1',
  toolName: 'write_file',
  modelVisibleName: 'write_file',
  title: 'Approve write_file',
  summary: 'Write src/a.ts',
  preview: { action: 'write', targets: [{ kind: 'file', label: 'src/a.ts' }] },
  requestedScope: 'once',
  status: 'pending',
  createdAt: '2026-06-20T00:00:00.000Z',
};

describe('ChatStreamEventSchema', () => {
  it('accepts assistant text and thinking deltas with required delta fields', () => {
    expect(ChatStreamEventSchema.safeParse({
      ...base,
      eventType: 'assistant.text.delta',
      textId: 'assistant-text-1',
      phase: 'answer',
      delta: 'hello',
    }).success).toBe(true);
    expect(ChatStreamEventSchema.safeParse({
      ...base,
      eventType: 'assistant.thinking.delta',
      thinkingId: 'thinking-1',
      delta: 'thinking',
    }).success).toBe(true);
  });

  it('rejects invalid assistant deltas and unknown event types', () => {
    expect(ChatStreamEventSchema.safeParse({
      ...base,
      eventType: 'assistant.text.delta',
      textId: 'assistant-text-1',
      phase: 'answer',
    }).success).toBe(false);
    expect(ChatStreamEventSchema.safeParse({
      ...base,
      eventType: 'renderer.unknown',
    }).success).toBe(false);
  });

  it('requires full approval request DTOs for approval.requested events', () => {
    expect(ChatStreamEventSchema.safeParse({
      ...base,
      eventType: 'approval.requested',
      approvalId: 'approval-1',
      approvalRequest,
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      scope: 'once',
      status: 'pending',
      title: 'Approve write_file',
      description: 'Write src/a.ts',
      subjectSummary: 'src/a.ts',
    }).success).toBe(true);
    expect(ChatStreamEventSchema.safeParse({
      ...base,
      eventType: 'approval.requested',
      approvalId: 'approval-1',
      toolCallId: 'tool-call-1',
    }).success).toBe(false);
  });

  it('requires stable tool disclosure fields for tool lifecycle events', () => {
    expect(ChatStreamEventSchema.safeParse({
      ...base,
      eventType: 'tool.started',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      inputSummary: 'src/a.ts',
    }).success).toBe(true);
    expect(ChatStreamEventSchema.safeParse({
      ...base,
      eventType: 'tool.completed',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      toolResultId: 'tool-result-1',
      resultSummary: 'ok',
    }).success).toBe(true);
    expect(ChatStreamEventSchema.safeParse({
      ...base,
      eventType: 'tool.completed',
      toolCallId: 'tool-call-1',
    }).success).toBe(false);
  });
});
