import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { RendererRunSummary } from '../../entities/run/store';

export type ProcessingDisclosureStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ProcessingDisclosureEntry {
  id: string;
  label: string;
  detail?: string;
  createdAt: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface ProcessingDisclosureModel {
  runId: string;
  status: ProcessingDisclosureStatus;
  statusLabel: string;
  durationLabel: string;
  live: boolean;
  startedAt: string;
  endedAt?: string;
  currentAction?: string;
  completedEntries: ProcessingDisclosureEntry[];
}

interface CreateProcessingDisclosureModelInput {
  run: RendererRunSummary;
  events: RuntimeEvent[];
  now?: Date;
}

function sortedEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  return [...events].sort((left, right) => left.sequence - right.sequence);
}

function payloadRecord(event: RuntimeEvent): Record<string, unknown> {
  return event.payload as Record<string, unknown>;
}

function payloadText(event: RuntimeEvent, key: string): string | undefined {
  const value = payloadRecord(event)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function payloadNumber(event: RuntimeEvent, key: string): number | undefined {
  const value = payloadRecord(event)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nestedErrorMessage(event: RuntimeEvent): string | undefined {
  const error = payloadRecord(event).error;

  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : undefined;
}

function stepLabel(event: RuntimeEvent): string {
  return payloadText(event, 'title') ?? payloadText(event, 'kind') ?? '运行步骤';
}

function statusFromRun(run: RendererRunSummary): ProcessingDisclosureStatus {
  if (run.status === 'completed') return 'completed';
  if (run.status === 'failed') return 'failed';
  if (run.status === 'cancelled') return 'cancelled';
  return 'running';
}

function statusLabel(status: ProcessingDisclosureStatus): string {
  if (status === 'completed') return '已处理';
  if (status === 'failed') return '处理失败';
  if (status === 'cancelled') return '已取消';
  return '正在处理';
}

export function formatProcessingDuration(startedAt: string, endedAt: string | Date): string {
  const started = new Date(startedAt).getTime();
  const ended = endedAt instanceof Date ? endedAt.getTime() : new Date(endedAt).getTime();

  if (Number.isNaN(started) || Number.isNaN(ended)) {
    return '0s';
  }

  const totalSeconds = Math.max(0, Math.floor((ended - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function describeCurrentAction(events: RuntimeEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    if (event.eventType === 'assistant.output.completed') return '正在整理最终回复...';
    if (event.eventType === 'approval.requested') return `等待审批：${payloadText(event, 'title') ?? '用户确认'}`;
    if (event.eventType === 'tool.execution.started') return `正在执行工具：${payloadText(event, 'toolName') ?? '工具调用'}`;
    if (event.eventType === 'tool.execution.requested') return `正在准备工具：${payloadText(event, 'toolName') ?? '工具调用'}`;
    if (event.eventType === 'memory.recall.requested') return '正在召回相关记忆...';
    if (event.eventType === 'context.patch.requested') return '正在准备上下文更新...';
    if (event.eventType === 'context.effective.updated') return '正在整理上下文...';
    if (event.eventType === 'step.started' || event.eventType === 'step.created') {
      return `正在处理步骤：${stepLabel(event)}`;
    }
    if (event.eventType === 'run.cancelling') return '正在取消运行...';
  }

  return undefined;
}

function describeCompletedEvent(event: RuntimeEvent): Omit<ProcessingDisclosureEntry, 'id' | 'createdAt'> | null {
  if (event.eventType === 'context.effective.updated') {
    const sourceCount = payloadNumber(event, 'sourceCount');
    return {
      label: '已更新有效上下文',
      detail: typeof sourceCount === 'number' ? `${sourceCount} 个来源` : undefined,
      tone: 'success',
    };
  }

  if (event.eventType === 'step.completed') {
    return { label: `已完成步骤：${stepLabel(event)}`, tone: 'success' };
  }

  if (event.eventType === 'step.failed') {
    return { label: `步骤失败：${nestedErrorMessage(event) ?? stepLabel(event)}`, tone: 'danger' };
  }

  if (event.eventType === 'tool.execution.completed') {
    const durationMs = payloadNumber(event, 'durationMs');
    return {
      label: `已完成工具：${payloadText(event, 'toolName') ?? '工具调用'}`,
      detail: typeof durationMs === 'number' ? `${durationMs}ms` : undefined,
      tone: 'success',
    };
  }

  if (event.eventType === 'tool.execution.failed') {
    return {
      label: `工具失败：${payloadText(event, 'toolName') ?? '工具调用'}`,
      detail: nestedErrorMessage(event),
      tone: 'danger',
    };
  }

  if (event.eventType === 'tool.execution.denied') {
    return {
      label: `工具被拒绝：${payloadText(event, 'toolName') ?? '工具调用'}`,
      detail: payloadText(event, 'reason'),
      tone: 'warning',
    };
  }

  if (event.eventType === 'approval.resolved') {
    return {
      label: `审批已处理：${payloadText(event, 'decision') ?? 'resolved'}`,
      detail: payloadText(event, 'scope'),
      tone: 'success',
    };
  }

  if (event.eventType === 'approval.expired') {
    return { label: '审批已过期', tone: 'warning' };
  }

  if (event.eventType === 'artifact.created') {
    return { label: `已创建产物：${payloadText(event, 'title') ?? 'Artifact'}`, tone: 'success' };
  }

  if (event.eventType === 'artifact.version.created') {
    const versionNumber = payloadNumber(event, 'versionNumber');
    return {
      label: '已创建产物版本',
      detail: typeof versionNumber === 'number' ? `v${versionNumber}` : undefined,
      tone: 'success',
    };
  }

  if (event.eventType === 'memory.recall.completed') {
    const selectedCount = payloadNumber(event, 'selectedCount');
    return {
      label: '已完成记忆召回',
      detail: typeof selectedCount === 'number' ? `${selectedCount} 条入选` : undefined,
      tone: 'success',
    };
  }

  if (event.eventType === 'checkpoint.created') {
    return {
      label: '已创建检查点',
      detail: payloadText(event, 'stateSummary'),
      tone: 'neutral',
    };
  }

  if (event.eventType === 'checkpoint.restored') {
    return { label: '已恢复检查点', tone: 'success' };
  }

  if (event.eventType === 'retry.completed') {
    return { label: '重试已完成', detail: payloadText(event, 'retryKind'), tone: 'success' };
  }

  if (event.eventType === 'retry.failed') {
    return { label: `重试失败：${nestedErrorMessage(event) ?? '未知错误'}`, tone: 'danger' };
  }

  if (event.eventType === 'run.completed') {
    return { label: '运行已完成', tone: 'success' };
  }

  if (event.eventType === 'run.failed') {
    return { label: `处理失败：${nestedErrorMessage(event) ?? '未知错误'}`, tone: 'danger' };
  }

  if (event.eventType === 'run.cancelled') {
    return { label: `已取消：${payloadText(event, 'reason') ?? nestedErrorMessage(event) ?? '用户取消'}`, tone: 'warning' };
  }

  return null;
}

function terminalEvent(events: RuntimeEvent[]): RuntimeEvent | undefined {
  return [...events].reverse().find((event) =>
    event.eventType === 'run.completed' || event.eventType === 'run.failed' || event.eventType === 'run.cancelled'
  );
}

function isTextDeltaEvent(event: RuntimeEvent): boolean {
  return event.eventType === 'assistant.output.delta' || event.eventType === 'model.output.delta';
}

export function createProcessingDisclosureModel({
  run,
  events,
  now = new Date(),
}: CreateProcessingDisclosureModelInput): ProcessingDisclosureModel | null {
  const orderedEvents = sortedEvents(events).filter((event) => !isTextDeltaEvent(event));

  if (orderedEvents.length === 0) {
    return null;
  }

  const firstEvent = orderedEvents[0];
  const finalEvent = terminalEvent(orderedEvents);
  const status = statusFromRun(run);
  const startedAt = firstEvent.createdAt;
  const endedAt = finalEvent?.createdAt;
  const durationLabel = formatProcessingDuration(startedAt, endedAt ?? now);
  const completedEntries = orderedEvents
    .map((event) => {
      const description = describeCompletedEvent(event);

      if (!description) {
        return null;
      }

      return {
        id: event.eventId,
        createdAt: event.createdAt,
        ...description,
      } satisfies ProcessingDisclosureEntry;
    })
    .filter((entry): entry is ProcessingDisclosureEntry => Boolean(entry));

  const currentAction = status === 'running'
    ? describeCurrentAction(orderedEvents) ?? '正在启动运行...'
    : undefined;

  return {
    runId: run.runId,
    status,
    statusLabel: statusLabel(status),
    durationLabel,
    live: status === 'running',
    startedAt,
    endedAt,
    currentAction,
    completedEntries,
  };
}

