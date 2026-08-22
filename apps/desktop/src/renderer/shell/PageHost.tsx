import { ChatPage } from '../features/chat';
import { DiscoveryPage } from '../features/discovery';

export function PageHost({ page }: { page: 'discovery' | 'chat' }) {
  return (
    <div data-testid="page-host" className="relative flex min-h-0 flex-1 overflow-hidden">
      {page === 'discovery' ? <DiscoveryPage /> : <ChatPage />}
    </div>
  );
}
