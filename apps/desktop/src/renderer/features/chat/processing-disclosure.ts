import type { RuntimeEvent } from '@megumi/product/runtime-events';
import type { RendererRunSummary } from '../../entities/run/store';

export type ProcessingDisclosureStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ProcessingDisclosureText {
  key: string;
  values?: Record<string, string | number>;
}

export interface ProcessingDisclosureEntry {
  id: string;
  label: ProcessingDisclosureText;
  detail?: string | ProcessingDisclosureText;
  createdAt: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface ProcessingDisclosureModel {
  runId: string;
  status: ProcessingDisclosureStatus;
  durationSeconds: number;
  live: boolean;
  startedAt: string;
  endedAt?: string;
  currentAction?: ProcessingDisclosureText;
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

function stepLabel(event: RuntimeEvent): string | undefined {
  return payloadText(event, 'title') ?? payloadText(event, 'kind');
}

function statusFromRun(run: RendererRunSummary): ProcessingDisclosureStatus {
  if (run.status === 'completed') return 'completed';
  if (run.status === 'failed') return 'failed';
  if (run.status === 'cancelled') return 'cancelled';
  return 'running';
}

export function calculateProcessingDurationSeconds(startedAt: string, endedAt: string | Date): number {
  const started = new Date(startedAt).getTime();
  const ended = endedAt instanceof Date ? endedAt.getTime() : new Date(endedAt).getTime();

  if (Number.isNaN(started) || Number.isNaN(ended)) {
    return 0;
  }

  const totalSeconds = Math.max(0, Math.floor((ended - started) / 1000));
  return totalSeconds;
}

function describeCurrentAction(events: RuntimeEvent[]): ProcessingDisclosureText | undefined {
  for (const event of [...events].reverse()) {
    if (event.eventType === 'assistant.output.completed') return { key: 'processing.projection.preparingReply' };
    if (event.eventType === 'approval.requested') {
      return { key: 'processing.projection.waitingApproval', values: { subject: payloadText(event, 'title') ?? '' } };
    }
    if (event.eventType === 'tool_call.started') {
      return { key: 'processing.projection.runningTool', values: { tool: payloadText(event, 'toolName') ?? '' } };
    }
    if (event.eventType === 'tool_call.requested') {
      return { key: 'processing.projection.preparingTool', values: { tool: payloadText(event, 'toolName') ?? '' } };
    }
    if (event.eventType === 'memory.recall.requested') return { key: 'processing.projection.recallingMemory' };
    if (event.eventType === 'context.patch.requested') return { key: 'processing.projection.preparingContext' };
    if (event.eventType === 'context.effective.updated') return { key: 'processing.projection.organizingContext' };
    if (event.eventType === 'step.started' || event.eventType === 'step.created') {
      return { key: 'processing.projection.processingStep', values: { step: stepLabel(event) ?? '' } };
    }
    if (event.eventType === 'run.cancelling') return { key: 'processing.projection.cancelling' };
  }

  return undefined;
}

function describeCompletedEvent(event: RuntimeEvent): Omit<ProcessingDisclosureEntry, 'id' | 'createdAt'> | null {
  if (event.eventType === 'context.effective.updated') {
    const sourceCount = payloadNumber(event, 'sourceCount');
    return {
      label: { key: 'processing.projection.contextUpdated' },
      detail: typeof sourceCount === 'number'
        ? { key: 'processing.projection.sources', values: { count: sourceCount } }
        : undefined,
      tone: 'success',
    };
  }

  if (event.eventType === 'step.completed') {
    return {
      label: { key: 'processing.projection.stepCompleted', values: { step: stepLabel(event) ?? '' } },
      tone: 'success',
    };
  }

  if (event.eventType === 'step.failed') {
    return {
      label: { key: 'processing.projection.stepFailed', values: { step: stepLabel(event) ?? '' } },
      detail: nestedErrorMessage(event),
      tone: 'danger',
    };
  }

  if (event.eventType === 'tool_call.completed') {
    return {
      label: { key: 'processing.projection.toolCompleted', values: { tool: payloadText(event, 'toolName') ?? '' } },
      tone: 'success',
    };
  }

  if (event.eventType === 'tool_call.failed') {
    return {
      label: { key: 'processing.projection.toolFailed', values: { tool: payloadText(event, 'toolName') ?? '' } },
      detail: nestedErrorMessage(event),
      tone: 'danger',
    };
  }

  if (event.eventType === 'tool_result.created') {
    const kind = payloadText(event, 'kind');
    if (kind === 'policy_denied' || kind === 'user_rejected') {
      return {
        label: { key: 'processing.projection.toolDenied', values: { tool: payloadText(event, 'toolName') ?? '' } },
        detail: payloadText(event, 'summary'),
        tone: 'warning',
      };
    }
    if (kind === 'failed') {
      return {
        label: { key: 'processing.projection.toolFailed', values: { tool: payloadText(event, 'toolName') ?? '' } },
        detail: payloadText(event, 'summary'),
        tone: 'danger',
      };
    }
    return {
      label: { key: 'processing.projection.toolCompleted', values: { tool: payloadText(event, 'toolName') ?? '' } },
      detail: payloadText(event, 'summary'),
      tone: 'success',
    };
  }

  if (event.eventType === 'approval.resolved') {
    return {
      label: { key: 'processing.projection.approvalResolved', values: { decision: payloadText(event, 'decision') ?? '' } },
      detail: payloadText(event, 'scope'),
      tone: 'success',
    };
  }

  if (event.eventType === 'approval.expired') {
    return { label: { key: 'processing.projection.approvalExpired' }, tone: 'warning' };
  }

  if (event.eventType === 'artifact.created') {
    return {
      label: { key: 'processing.projection.artifactCreated', values: { title: payloadText(event, 'title') ?? 'Artifact' } },
      tone: 'success',
    };
  }

  if (event.eventType === 'artifact.version.created') {
    const versionNumber = payloadNumber(event, 'versionNumber');
    return {
      label: { key: 'processing.projection.artifactVersionCreated' },
      detail: typeof versionNumber === 'number' ? `v${versionNumber}` : undefined,
      tone: 'success',
    };
  }

  if (event.eventType === 'memory.recall.completed') {
    const selectedCount = payloadNumber(event, 'selectedCount');
    return {
      label: { key: 'processing.projection.memoryRecalled' },
      detail: typeof selectedCount === 'number'
        ? { key: 'processing.projection.memoriesSelected', values: { count: selectedCount } }
        : undefined,
      tone: 'success',
    };
  }

  if (event.eventType === 'checkpoint.created') {
    return {
      label: { key: 'processing.projection.checkpointCreated' },
      detail: payloadText(event, 'stateSummary'),
      tone: 'neutral',
    };
  }

  if (event.eventType === 'checkpoint.restored') {
    return { label: { key: 'processing.projection.checkpointRestored' }, tone: 'success' };
  }

  if (event.eventType === 'retry.completed') {
    return { label: { key: 'processing.projection.retryCompleted' }, detail: payloadText(event, 'retryKind'), tone: 'success' };
  }

  if (event.eventType === 'retry.failed') {
    return { label: { key: 'processing.projection.retryFailed' }, detail: nestedErrorMessage(event), tone: 'danger' };
  }

  if (event.eventType === 'run.completed') {
    return { label: { key: 'processing.projection.runCompleted' }, tone: 'success' };
  }

  if (event.eventType === 'run.failed') {
    return { label: { key: 'processing.projection.runFailed' }, detail: nestedErrorMessage(event), tone: 'danger' };
  }

  if (event.eventType === 'run.cancelled') {
    return {
      label: { key: 'processing.projection.runCancelled' },
      detail: payloadText(event, 'reason') ?? nestedErrorMessage(event),
      tone: 'warning',
    };
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
  const durationSeconds = calculateProcessingDurationSeconds(startedAt, endedAt ?? now);
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
    ? describeCurrentAction(orderedEvents) ?? { key: 'processing.projection.starting' }
    : undefined;

  return {
    runId: run.runId,
    status,
    durationSeconds,
    live: status === 'running',
    startedAt,
    endedAt,
    currentAction,
    completedEntries,
  };
}
