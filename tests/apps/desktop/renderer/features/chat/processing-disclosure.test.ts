// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { RendererRunSummary } from '@megumi/desktop/renderer/entities/run/store';
import {
  createProcessingDisclosureModel,
  formatProcessingDuration,
} from '@megumi/desktop/renderer/features/chat/processing-disclosure';

function runtimeEvent(
  eventType: RuntimeEvent['eventType'],
  sequence: number,
  payload: RuntimeEvent['payload'] = {},
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return {
    eventId: `event-${sequence}`,
    schemaVersion: 1,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence,
    createdAt: `2026-05-18T12:00:${sequence.toString().padStart(2, '0')}.000Z`,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload,
    ...overrides,
  } as RuntimeEvent;
}

function runSummary(status: RendererRunSummary['status']): RendererRunSummary {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    status,
    updatedAt: '2026-05-18T12:00:10.000Z',
  };
}

describe('processing disclosure projection', () => {
  it('formats short and minute-level durations', () => {
    expect(formatProcessingDuration('2026-05-18T12:00:00.000Z', '2026-05-18T12:00:42.000Z')).toBe('42s');
    expect(formatProcessingDuration('2026-05-18T12:00:00.000Z', '2026-05-18T12:01:42.000Z')).toBe('1m 42s');
  });

  it('creates a running model with a current action and completed factual entries', () => {
    const model = createProcessingDisclosureModel({
      run: runSummary('running'),
      events: [
        runtimeEvent('run.started', 1, { providerId: 'deepseek', modelId: 'deepseek-v4-flash', runKind: 'chat' }),
        runtimeEvent('context.effective.updated', 2, { sourceCount: 3 }),
        runtimeEvent('step.completed', 3, { kind: 'context', title: '读取当前上下文' }, { stepId: 'step-1' }),
        runtimeEvent('assistant.output.delta', 4, { delta: '正在生成' }),
      ],
      now: new Date('2026-05-18T12:00:42.000Z'),
    });

    expect(model!).toMatchObject({
      runId: 'run-1',
      status: 'running',
      statusLabel: '正在处理',
      durationLabel: '41s',
      live: true,
    });
    expect(model!.currentAction).toBeDefined();
    expect(model!.completedEntries.map((entry) => entry.id)).not.toContain('event-4');
    expect(model!.completedEntries.map((entry) => entry.label)).toEqual([
      '已更新有效上下文',
      '已完成步骤：读取当前上下文',
    ]);
  });

  it('does not create a visible model for a bare run start event', () => {
    const model = createProcessingDisclosureModel({
      run: runSummary('running'),
      events: [
        runtimeEvent('run.started', 1, { runKind: 'chat' }),
      ],
      now: new Date('2026-05-18T12:00:10.000Z'),
    });

    expect(model).toBeNull();
  });

  it('creates a completed model that remains factual and has no guessed next step', () => {
    const model = createProcessingDisclosureModel({
      run: runSummary('completed'),
      events: [
        runtimeEvent('run.started', 1, { runKind: 'chat' }),
        runtimeEvent('tool.call.completed', 2, {
          toolCallId: 'tool-1',
          toolName: 'workspace.read',
          resultPreview: { files: 2 },
          durationMs: 1200,
        }),
        runtimeEvent('artifact.created', 3, {
          artifactId: 'artifact-1',
          kind: 'report',
          title: 'UI 调整说明',
          status: 'draft',
        }),
        runtimeEvent('run.completed', 4),
      ],
      now: new Date('2026-05-18T12:00:30.000Z'),
    });

    expect(model!).toMatchObject({
      status: 'completed',
      statusLabel: '已处理',
      live: false,
      currentAction: undefined,
    });
    expect(model!.completedEntries.map((entry) => entry.label)).toEqual([
      '已完成工具：workspace.read',
      '已创建产物：UI 调整说明',
      '运行已完成',
    ]);
    expect(JSON.stringify(model!)).not.toMatch(/下一步|next step|思考过程|chain-of-thought/i);
  });

  it('creates failed and cancelled models from terminal events', () => {
    const failed = createProcessingDisclosureModel({
      run: runSummary('failed'),
      events: [
        runtimeEvent('run.started', 1),
        runtimeEvent('run.failed', 2, {
          error: {
            code: 'provider_failed',
            message: 'Provider failed.',
            severity: 'error',
            retryable: false,
            source: 'provider',
          },
        }),
      ],
      now: new Date('2026-05-18T12:00:30.000Z'),
    });
    const cancelled = createProcessingDisclosureModel({
      run: runSummary('cancelled'),
      events: [
        runtimeEvent('run.started', 1),
        runtimeEvent('run.cancelled', 2, { reason: 'User stopped the run.' }),
      ],
      now: new Date('2026-05-18T12:00:30.000Z'),
    });

    expect(failed!).toMatchObject({
      status: 'failed',
      statusLabel: '处理失败',
      currentAction: undefined,
    });
    expect(failed!.completedEntries.at(-1)?.label).toBe('处理失败：Provider failed.');
    expect(cancelled!).toMatchObject({
      status: 'cancelled',
      statusLabel: '已取消',
      currentAction: undefined,
    });
    expect(cancelled!.completedEntries.at(-1)?.label).toBe('已取消：User stopped the run.');
  });
});
