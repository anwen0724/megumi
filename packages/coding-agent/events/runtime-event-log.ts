// Owns runtime event sequencing, request metadata, append, and stream fan-out.
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeContext, RuntimeEvent } from '@megumi/shared/runtime';
import {
  withRequestMetadata,
  withSequenceAfter,
  withSessionMessageRequestMetadata,
} from './runtime-event-metadata';

export interface RuntimeEventLogRepository {
  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent;
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
}

export interface RuntimeEventLogStreamSink {
  handleRuntimeEvent?(event: RuntimeEvent): void;
  dispose?(): void;
}

export interface RuntimeEventLogAppendOptions {
  streamSink?: RuntimeEventLogStreamSink;
  onTerminalEvent?: (event: RuntimeEvent) => void;
}

export interface RuntimeEventLogRequestMetadata {
  requestId: string;
  runtimeContext?: RuntimeContext;
}

export class RuntimeEventSequenceCursor {
  constructor(private lastSequence: number) {}

  next(): number {
    this.lastSequence += 1;
    return this.lastSequence;
  }

  normalize(event: RuntimeEvent): RuntimeEvent {
    const sequenced = withSequenceAfter(event, this.lastSequence);
    this.lastSequence = sequenced.sequence;
    return sequenced;
  }

  value(): number {
    return this.lastSequence;
  }
}

export class RuntimeEventLog {
  constructor(private readonly repository: RuntimeEventLogRepository) {}

  listByRun(runId: string): RuntimeEvent[] {
    return this.repository.listRuntimeEventsByRun(runId);
  }

  lastSequenceForRun(runId: string): number {
    return lastRuntimeEventSequence(this.listByRun(runId));
  }

  nextSequenceForRun(runId: string): number {
    return this.lastSequenceForRun(runId) + 1;
  }

  createSequenceCursor(input: { runId: string; startSequence?: number }): RuntimeEventSequenceCursor {
    return new RuntimeEventSequenceCursor(Math.max(
      input.startSequence ?? 0,
      this.lastSequenceForRun(input.runId),
    ));
  }

  withModelRequestMetadata(event: RuntimeEvent, request: ModelStepRuntimeRequest): RuntimeEvent {
    return withRequestMetadata(event, request);
  }

  withRuntimeRequestMetadata(
    event: RuntimeEvent,
    request: RuntimeEventLogRequestMetadata,
  ): RuntimeEvent {
    return withSessionMessageRequestMetadata(event, request);
  }

  normalizeWithModelRequest(
    event: RuntimeEvent,
    request: ModelStepRuntimeRequest,
    input: { afterSequence: number },
  ): RuntimeEvent {
    return this.withModelRequestMetadata(withSequenceAfter(event, input.afterSequence), request);
  }

  normalizeWithRuntimeRequest(
    event: RuntimeEvent,
    request: RuntimeEventLogRequestMetadata,
    input: { afterSequence: number },
  ): RuntimeEvent {
    return this.withRuntimeRequestMetadata(withSequenceAfter(event, input.afterSequence), request);
  }

  append(event: RuntimeEvent, options: RuntimeEventLogAppendOptions = {}): RuntimeEvent {
    if (isRunTerminalRuntimeEvent(event)) {
      options.onTerminalEvent?.(event);
    }
    const persisted = this.repository.appendRuntimeEvent(event);
    options.streamSink?.handleRuntimeEvent?.(persisted);
    if (isRunTerminalRuntimeEvent(persisted)) {
      options.streamSink?.dispose?.();
    }
    return persisted;
  }

  appendWithRuntimeRequest(
    event: RuntimeEvent,
    request: RuntimeEventLogRequestMetadata,
    options: RuntimeEventLogAppendOptions & { afterSequence?: number } = {},
  ): RuntimeEvent {
    const cursor = this.createSequenceCursor({
      runId: event.runId ?? '',
      ...(options.afterSequence !== undefined ? { startSequence: options.afterSequence } : {}),
    });
    return this.append(
      this.withRuntimeRequestMetadata(cursor.normalize(event), request),
      options,
    );
  }
}

export function lastRuntimeEventSequence(events: RuntimeEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.sequence), 0);
}

export function nextRuntimeEventSequence(events: RuntimeEvent[]): number {
  return lastRuntimeEventSequence(events) + 1;
}

export function isRunTerminalRuntimeEvent(event: RuntimeEvent): boolean {
  return event.eventType === 'run.completed'
    || event.eventType === 'run.failed'
    || event.eventType === 'run.cancelled';
}
