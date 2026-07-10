/*
 * Forwards Coding Agent runtime events to renderer windows.
 */
import {
  RuntimeEventSchema,
  type RuntimeEvent,
} from '@megumi/product/runtime-events';
import type { RuntimeLogger } from '@megumi/product/logging';
import { IPC_CHANNELS } from './channels';

export function forwardRuntimeEvent(
  sender: { send(channel: string, event: RuntimeEvent): void },
  event: RuntimeEvent,
  options: { logger?: RuntimeLogger } = {},
): void {
  const parsed = RuntimeEventSchema.safeParse(event);
  if (!parsed.success) {
    options.logger?.warn?.('Dropped invalid runtime event.', { error: parsed.error.message });
    return;
  }
  sender.send(IPC_CHANNELS.runtime.event, parsed.data as RuntimeEvent);
}

export async function forwardRuntimeEvents(
  sender: { send(channel: string, event: RuntimeEvent): void },
  events: AsyncIterable<RuntimeEvent>,
  options: { logger?: RuntimeLogger } = {},
): Promise<void> {
  for await (const event of events) {
    forwardRuntimeEvent(sender, event, options);
  }
}
