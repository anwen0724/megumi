import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { RuntimeEventSchema } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { redactRuntimeValue } from '@megumi/security/redaction';
import {
  noopRuntimeLogger,
  type RuntimeLogger,
} from '../services/runtime/runtime-logger.service';

export interface RuntimeEventSender {
  send(channel: string, event: RuntimeEvent): void;
}

export interface ForwardRuntimeEventsOptions {
  logger?: RuntimeLogger;
}

export async function forwardRuntimeEvents(
  sender: RuntimeEventSender,
  stream: AsyncIterable<RuntimeEvent>,
  options: ForwardRuntimeEventsOptions = {},
): Promise<void> {
  const logger = options.logger ?? noopRuntimeLogger;

  for await (const runtimeEvent of stream) {
    const parsed = RuntimeEventSchema.safeParse(runtimeEvent);

    if (!parsed.success) {
      logger.warn('runtime_event_invalid', {
        ...eventDiagnostics(runtimeEvent),
        issueCount: parsed.error.issues.length,
      });
      continue;
    }

    try {
      sender.send(IPC_CHANNELS.runtime.event, redactRuntimeValue(parsed.data) as RuntimeEvent);
    } catch {
      logger.error('runtime_event_send_failed', {
        ...eventDiagnostics(parsed.data),
        message: 'Runtime event delivery failed.',
      });
    }
  }
}

function eventDiagnostics(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== 'object') {
    return { eventType: 'unknown' };
  }

  const value = event as Partial<RuntimeEvent>;
  return redactRuntimeValue({
    eventId: value.eventId,
    eventType: value.eventType,
    requestId: value.requestId,
    traceId: value.context?.traceId,
    debugId: value.context?.debugId,
    operationName: value.context?.operationName,
    source: value.source,
  }) as Record<string, unknown>;
}


