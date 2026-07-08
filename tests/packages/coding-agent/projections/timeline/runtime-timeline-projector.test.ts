import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@megumi/coding-agent/events';
import { reduceRuntimeTimelineEvent } from '@megumi/coding-agent/projections/timeline';

function event(
  eventType: RuntimeEvent['eventType'],
  payload: Record<string, unknown>,
  sequence: number,
): RuntimeEvent {
  return {
    eventId: `event:${sequence}`,
    schemaVersion: 1,
    eventType,
    runId: 'run:1',
    sessionId: 'session:1',
    requestId: 'request:1',
    sequence,
    createdAt: `2026-07-09T00:00:0${sequence}.000Z`,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload,
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
    }, 6));

    const assistant = messages.find((message) => message.role === 'assistant');
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
    expect(JSON.stringify(process)).toContain('已读取目录。');
    expect(answer).toEqual(expect.objectContaining({
      text: '目录里有 README.md。',
      status: 'completed',
    }));
  });
});
