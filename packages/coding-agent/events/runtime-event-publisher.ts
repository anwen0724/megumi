// Publishes runtime events with stream fan-out and terminal hook dispatch.
import type { RuntimeEvent } from '@megumi/shared/runtime';
import {
  RuntimeEventLog,
  type RuntimeEventLogAppendOptions,
  type RuntimeEventLogRequestMetadata,
  type RuntimeEventLogStreamSink,
} from './runtime-event-log';

export interface RuntimeEventTerminalHooksPort<TProjection> {
  publishRunTerminalHooks(input: {
    event: RuntimeEvent;
    chatStreamAdapter?: TProjection;
  }): void;
}

export interface RuntimeEventPublisherOptions<TProjection extends RuntimeEventLogStreamSink> {
  eventLog: RuntimeEventLog;
  terminalHooks?: RuntimeEventTerminalHooksPort<TProjection>;
}

export interface RuntimeEventPublisherAppendOptions<TProjection extends RuntimeEventLogStreamSink> {
  chatStreamAdapter?: TProjection;
  afterSequence?: number;
}

export class RuntimeEventPublisher<TProjection extends RuntimeEventLogStreamSink> {
  private readonly eventLog: RuntimeEventLog;
  private readonly terminalHooks?: RuntimeEventTerminalHooksPort<TProjection>;

  constructor(options: RuntimeEventPublisherOptions<TProjection>) {
    this.eventLog = options.eventLog;
    this.terminalHooks = options.terminalHooks;
  }

  append(event: RuntimeEvent, options: RuntimeEventPublisherAppendOptions<TProjection> = {}): RuntimeEvent {
    return this.eventLog.append(event, this.createLogAppendOptions(options));
  }

  appendWithRuntimeRequest(
    event: RuntimeEvent,
    request: RuntimeEventLogRequestMetadata,
    options: RuntimeEventPublisherAppendOptions<TProjection> = {},
  ): RuntimeEvent {
    return this.eventLog.appendWithRuntimeRequest(
      event,
      request,
      {
        ...this.createLogAppendOptions(options),
        ...(options.afterSequence !== undefined ? { afterSequence: options.afterSequence } : {}),
      },
    );
  }

  private createLogAppendOptions(
    options: RuntimeEventPublisherAppendOptions<TProjection>,
  ): RuntimeEventLogAppendOptions {
    return {
      ...(options.chatStreamAdapter ? { streamSink: options.chatStreamAdapter } : {}),
      ...(this.terminalHooks ? {
        onTerminalEvent: (event: RuntimeEvent) => {
          this.terminalHooks?.publishRunTerminalHooks({
            event,
            ...(options.chatStreamAdapter ? { chatStreamAdapter: options.chatStreamAdapter } : {}),
          });
        },
      } : {}),
    };
  }
}
