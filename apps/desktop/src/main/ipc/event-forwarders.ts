/*
 * Forwards Agent runtime events to renderer windows.
 */
import {
  RuntimeEventSchema,
  type AnyEvent,
} from '@megumi/product/host';
import type { DesktopRuntimeLogger as ProductRuntimeLogger } from '../runtime-logger';
import { IPC_CHANNELS } from './channels';

export function forwardRuntimeEvent(
  sender: { send(channel: string, event: AnyEvent): void },
  event: AnyEvent,
  options: { logger?: ProductRuntimeLogger } = {},
): void {
  const parsed = RuntimeEventSchema.safeParse(event);
  if (!parsed.success) {
    options.logger?.warn?.('Dropped invalid runtime event.', { error: parsed.error.message });
    return;
  }
  sender.send(IPC_CHANNELS.runtime.event, parsed.data as AnyEvent);
}
