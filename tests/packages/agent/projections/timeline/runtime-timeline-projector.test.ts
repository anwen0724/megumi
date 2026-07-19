import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@megumi/agent/events';
import { reduceRuntimeTimelineEvent } from '@megumi/agent/projections/timeline';

function event(
  eventType: RuntimeEvent['eventType'],
  payload: Record<string, unknown>,
  sequence: number,
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return {
    eventId: `event:${sequence}`,
    schemaVersion: 1,
    eventType,
    runId: 'run:1',
    sessionId: 'session:1',
    requestId: 'request:1',
    sequence,
    createdAt: `2026-07-09T00:00:${sequence.toString().padStart(2, '0')}.000Z`,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload,
    ...overrides,
  };
}

describe('runtime timeline projection', () => {
  it('streams model text into assistant answer block', () => {
    let messages = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    messages = reduceRuntimeTimelineEvent(messages, event('model_call.started', {
      modelCallId: 'model-call:1',
      providerId: 'DeepSeek',
      modelId: 'deepseek-v4-flash',
    }, 2));
    messages = reduceRuntimeTimelineEvent(messages, event('model_call.text_delta', {
      modelCallId: 'model-call:1',
      delta: '你好',
    }, 3));
    messages = reduceRuntimeTimelineEvent(messages, event('model_call.text_delta', {
      modelCallId: 'model-call:1',
      delta: '，我在。',
    }, 4));
    messages = reduceRuntimeTimelineEvent(messages, event('model_call.completed', {
      modelCallId: 'model-call:1',
      finishReason: 'stop',
    }, 5));
    messages = reduceRuntimeTimelineEvent(messages, event('run.completed', {
      assistantMessageId: 'message:assistant:1',
    }, 6, { messageId: 'message:assistant:1' }));

    const assistant = messages.find((message) => message.role === 'assistant');
    expect(assistant?.messageId).toBe('message:assistant:1');
    expect(assistant?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'process_disclosure', status: 'completed' }),
      expect.objectContaining({ kind: 'answer_text', text: '你好，我在。', status: 'completed' }),
    ]));
  });

  it('moves pre-tool model text into the process block and keeps final answer separate', () => {
    let messages = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    messages = reduceRuntimeTimelineEvent(messages, event('model_call.started', {
      modelCallId: 'model-call:1',
      providerId: 'DeepSeek',
      modelId: 'deepseek-v4-flash',
    }, 2));
    messages = reduceRuntimeTimelineEvent(messages, event('model_call.text_delta', {
      modelCallId: 'model-call:1',
      delta: '我先读取目录。',
    }, 3));
    messages = reduceRuntimeTimelineEvent(messages, event('model_call.tool_call', {
      modelCallId: 'model-call:1',
      toolCallId: 'tool-call:1',
      toolName: 'list_directory',
      input: { path: '.' },
    }, 4));
    messages = reduceRuntimeTimelineEvent(messages, event('tool_result.created', {
      toolResultId: 'tool-result:1',
      toolCallId: 'tool-call:1',
      toolExecutionId: 'tool-execution:1',
      toolName: 'list_directory',
      kind: 'success',
      summary: '已读取目录。',
    }, 5));
    messages = reduceRuntimeTimelineEvent(messages, event('model_call.started', {
      modelCallId: 'model-call:2',
      providerId: 'DeepSeek',
      modelId: 'deepseek-v4-flash',
    }, 6));
    messages = reduceRuntimeTimelineEvent(messages, event('model_call.text_delta', {
      modelCallId: 'model-call:2',
      delta: '目录里有 README.md。',
    }, 7));
    messages = reduceRuntimeTimelineEvent(messages, event('run.completed', {
      assistantMessageId: 'message:assistant:1',
    }, 8));

    const assistant = messages.find((message) => message.role === 'assistant');
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');
    const answer = assistant?.blocks.find((block) => block.kind === 'answer_text');

    expect(process).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(JSON.stringify(process)).toContain('我先读取目录。');
    expect(JSON.stringify(process)).toContain('工作区目录');
    expect(JSON.stringify(process)).not.toContain('已读取目录。');
    expect(answer).toEqual(expect.objectContaining({
      text: '目录里有 README.md。',
      status: 'completed',
    }));
  });

  it('projects built-in tool inputs into user-facing targets without raw argument JSON or result content', () => {
    let messages = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    messages = reduceRuntimeTimelineEvent(messages, event('model_call.tool_call', {
      modelCallId: 'model-call:1',
      toolCallId: 'tool-call:1',
      toolName: 'list_directory',
      input: { path: '.', limit: 30 },
    }, 2));
    messages = reduceRuntimeTimelineEvent(messages, event('tool_result.created', {
      toolResultId: 'tool-result:1',
      toolCallId: 'tool-call:1',
      toolExecutionId: 'tool-execution:1',
      toolName: 'list_directory',
      kind: 'success',
      summary: '{"path":".","entries":[{"name":"README.md"}]}',
    }, 3));

    const assistant = messages.find((message) => message.role === 'assistant');
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');
    const tool = process?.items.find((item) => item.kind === 'tool_activity');

    expect(tool).toMatchObject({
      kind: 'tool_activity',
      toolName: 'list_directory',
      inputSummary: '工作区目录',
      status: 'succeeded',
    });
    expect(JSON.stringify(tool)).not.toContain('"path":"."');
    expect(JSON.stringify(tool)).not.toContain('README.md');
  });

  it('projects every run process event family into process disclosure items', () => {
    let messages = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    messages = reduceRuntimeTimelineEvent(messages, event('model.thinking.started', {
      modelStepId: 'model-call:1',
    }, 2));
    messages = reduceRuntimeTimelineEvent(messages, event('model.thinking.delta', {
      modelStepId: 'model-call:1',
      delta: 'I should inspect the workspace.',
    }, 3));
    messages = reduceRuntimeTimelineEvent(messages, event('model.thinking.completed', {
      modelStepId: 'model-call:1',
    }, 4));
    messages = reduceRuntimeTimelineEvent(messages, event('approval.requested', {
      approvalRequest: {
        approvalRequestId: 'approval:1',
        toolCallId: 'tool-call:1',
        toolExecutionId: 'tool-execution:1',
        runId: 'run:1',
        toolName: 'edit_file',
        capabilities: ['project_write'],
        riskLevel: 'medium',
        title: 'Edit file',
        summary: 'Edit README.md',
        requestedScope: 'once',
        status: 'pending',
        createdAt: '2026-07-09T00:00:05.000Z',
      },
    }, 5));
    messages = reduceRuntimeTimelineEvent(messages, event('approval.resolved', {
      approvalRequestId: 'approval:1',
      decision: 'approved',
      scope: 'once',
      decidedAt: '2026-07-09T00:00:06.000Z',
    }, 6));
    messages = reduceRuntimeTimelineEvent(messages, event('retry.started', {
      retryRequestId: 'retry:1',
      retryKind: 'model_call',
    }, 7));
    messages = reduceRuntimeTimelineEvent(messages, event('retry.failed', {
      retryRequestId: 'retry:1',
      retryKind: 'model_call',
      error: {
        code: 'provider_http_error',
        message: 'Provider returned 503.',
        severity: 'error',
        retryable: true,
        source: 'provider',
      },
    }, 8));
    messages = reduceRuntimeTimelineEvent(messages, event('retry.completed', {
      retryRequestId: 'retry:1',
      retryKind: 'model_call',
    }, 9));
    messages = reduceRuntimeTimelineEvent(messages, event('context.compaction.completed', {
      compactionId: 'compaction:1',
      triggerReason: 'automatic',
      tokensBefore: 240000,
      firstKeptSourceRef: { sourceId: 'message:1', sourceKind: 'session_message' },
      summarizedSourceCount: 12,
    }, 10));
    messages = reduceRuntimeTimelineEvent(messages, event('run.interrupted', {
      interruptedMarkerId: 'interrupted:1',
      previousStatus: 'running',
      reason: 'runtime_shutdown',
    }, 11));
    messages = reduceRuntimeTimelineEvent(messages, event('run.resume.requested', {
      resumeRequestId: 'resume:1',
      requestedBy: 'user',
      reason: 'approval_decision',
      resumeMode: 'continue',
    }, 12));
    messages = reduceRuntimeTimelineEvent(messages, event('run.resumed', {
      resumeRequestId: 'resume:1',
    }, 13));
    messages = reduceRuntimeTimelineEvent(messages, event('run.resume.failed', {
      resumeRequestId: 'resume:2',
      error: {
        code: 'resume_failed',
        message: 'Cannot resume run.',
        severity: 'error',
        retryable: false,
        source: 'core',
      },
    }, 14));
    messages = reduceRuntimeTimelineEvent(messages, event('run.failed', {
      error: {
        code: 'model_call_failed',
        message: 'Model call failed.',
        severity: 'error',
        retryable: false,
        source: 'provider',
      },
    }, 15));
    messages = reduceRuntimeTimelineEvent(messages, event('run.cancelled', {
      reason: 'user_requested',
    }, 16));

    const assistant = messages.find((message) => message.role === 'assistant');
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');
    const answer = assistant?.blocks.find((block) => block.kind === 'answer_text');

    expect(process?.items.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'thinking',
      'approval_activity',
      'retry_activity',
      'compaction_activity',
      'recovery_activity',
      'error_activity',
      'cancelled_activity',
    ]));
    expect(answer).toMatchObject({
      status: 'cancelled',
      text: '',
    });
  });

  it('does not project session-scoped compaction into an assistant message', () => {
    const messages = reduceRuntimeTimelineEvent([], event('context.compaction.completed', {
      compactionId: 'compaction:session',
      triggerReason: 'automatic',
      tokensBefore: 240000,
      firstKeptSourceRef: { sourceId: 'message:1', sourceKind: 'session_message' },
      summarizedSourceCount: 12,
    }, 1, { runId: undefined }));

    expect(messages).toEqual([]);
  });

  it('updates one compaction disclosure item from running to failed', () => {
    let messages = reduceRuntimeTimelineEvent([], event('context.compaction.started', {
      compactionId: 'compaction:failed-1',
      triggerReason: 'automatic',
      tokensBefore: 240000,
      firstKeptSourceRef: { sourceId: 'message:1', sourceKind: 'session_message' },
      summarizedSourceCount: 12,
    }, 1));
    messages = reduceRuntimeTimelineEvent(messages, event('context.compaction.failed', {
      compactionId: 'compaction:failed-1',
      triggerReason: 'automatic',
      tokensBefore: 240000,
      error: {
        code: 'context_budget_exceeded',
        message: 'Summary generation failed.',
        severity: 'error',
        retryable: true,
        source: 'core',
      },
    }, 2));

    const assistant = messages.find((message) => message.role === 'assistant');
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');
    const compactions = process?.items.filter((item) => item.kind === 'compaction_activity');
    expect(compactions).toHaveLength(1);
    expect(compactions?.[0]).toMatchObject({
      status: 'failed',
      label: '上下文压缩失败：Summary generation failed.',
    });
  });
});
