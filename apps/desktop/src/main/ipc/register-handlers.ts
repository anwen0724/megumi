import { registerWindowHandlers } from './handlers/window.handler';
import { registerProviderHandlers } from './handlers/provider.handler';
import { registerChatHandlers } from './handlers/chat.handler';
import type { RuntimeLogger } from '../services/runtime-logger.service';

export interface RegisterAllHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerAllHandlers(options: RegisterAllHandlersOptions = {}): void {
  registerWindowHandlers();
  registerProviderHandlers(undefined, { logger: options.logger });
  registerChatHandlers(undefined, { logger: options.logger });
}
