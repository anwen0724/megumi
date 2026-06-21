// Provides async iteration and final-message collection for assistant message streams.
import { createProviderError } from './errors';
import { type AssistantMessage } from './message';
import { type AssistantStreamEvent } from './stream';

export class AssistantMessageEventStream implements AsyncIterable<AssistantStreamEvent> {
  private readonly events: AssistantStreamEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private closed = false;

  static from(events: Iterable<AssistantStreamEvent> | AsyncIterable<AssistantStreamEvent>): AssistantMessageEventStream {
    const stream = new AssistantMessageEventStream();
    void stream.consume(events);
    return stream;
  }

  push(event: AssistantStreamEvent): void {
    if (this.closed) {
      throw new Error('Cannot push to a closed assistant message event stream.');
    }
    this.events.push(event);
    this.flush();
  }

  close(): void {
    this.closed = true;
    this.flush();
  }

  async result(): Promise<AssistantMessage> {
    let terminal: AssistantMessage | undefined;

    for await (const event of this) {
      if (event.type === 'message_end') {
        terminal = event.message;
      }
      if (event.type === 'error') {
        terminal = event.message;
      }
    }

    if (!terminal) {
      return {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        error: createProviderError({
          providerId: 'unknown',
          modelId: 'unknown',
          code: 'stream_source_error',
          message: 'Assistant message stream ended without a terminal event.',
          retryable: false,
        }),
      };
    }

    return terminal;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
    let index = 0;

    while (true) {
      while (index < this.events.length) {
        const event = this.events[index];
        index += 1;
        yield event;
      }

      if (this.closed) {
        return;
      }

      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private async consume(events: Iterable<AssistantStreamEvent> | AsyncIterable<AssistantStreamEvent>): Promise<void> {
    try {
      for await (const event of events) {
        this.push(event);
      }
    } catch (error) {
      if (!this.closed) {
        this.push({
          type: 'error',
          reason: 'error',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            error: createProviderError({
              providerId: 'unknown',
              modelId: 'unknown',
              code: 'stream_source_error',
              message: 'Assistant message stream source failed.',
              retryable: true,
              details: {
                errorName: error instanceof Error ? error.name : 'UnknownError',
                errorMessage: redactSecret(error instanceof Error ? error.message : String(error)),
              },
            }),
          },
        });
      }
    } finally {
      this.close();
    }
  }

  private flush(): void {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }
}

function redactSecret(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
}
