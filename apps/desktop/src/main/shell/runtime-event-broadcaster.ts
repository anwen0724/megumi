// Forwards Coding Agent RuntimeEvent objects to the current Electron renderer window.
import type { RuntimeEvent } from '@megumi/coding-agent/events';
import { forwardRuntimeEvent } from '../ipc/event-forwarders';
import type { RuntimeLogger } from '../services/agent-run/runtime-logger.service';

export interface RuntimeEventBroadcastWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, event: RuntimeEvent): void };
}

export interface RuntimeEventBroadcaster {
  publish(event: RuntimeEvent): void;
  setWindow(window: RuntimeEventBroadcastWindow | undefined): void;
}

export function createRuntimeEventBroadcaster(
  options: { logger?: RuntimeLogger } = {},
): RuntimeEventBroadcaster {
  let window: RuntimeEventBroadcastWindow | undefined;

  return {
    setWindow(nextWindow) {
      window = nextWindow;
    },
    publish(event) {
      if (!window || window.isDestroyed()) {
        return;
      }
      forwardRuntimeEvent(window.webContents, event, { logger: options.logger });
    },
  };
}
