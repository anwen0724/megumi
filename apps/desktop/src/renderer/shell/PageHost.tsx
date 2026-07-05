import { ChatPage } from '../features/chat';

export function PageHost() {
  return (
    <div data-testid="page-host" className="relative flex min-h-0 flex-1 overflow-hidden">
      <ChatPage />
    </div>
  );
}
