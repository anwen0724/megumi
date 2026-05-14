import { registerWindowHandlers } from './handlers/window.handler';
import { registerProviderHandlers } from './handlers/provider.handler';
import { registerChatHandlers } from './handlers/chat.handler';

export function registerAllHandlers(): void {
  registerWindowHandlers();
  registerProviderHandlers();
  registerChatHandlers();
}
