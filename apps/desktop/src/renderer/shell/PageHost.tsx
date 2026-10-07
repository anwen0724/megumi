import { ChatPage } from '../features/chat';
import { DiscoveryPage } from '../features/discovery';

export function PageHost({
  page,
  onOpenContentSources,
  onOpenModelSettings,
}: {
  page: 'discovery' | 'chat';
  onOpenContentSources: () => void;
  onOpenModelSettings?: () => void;
}) {
  return (
    <div key={page} data-testid="page-host" className="ui-page-enter relative flex min-h-0 flex-1 overflow-hidden">
      {page === 'discovery' ? (
        <DiscoveryPage onOpenContentSources={onOpenContentSources} />
      ) : (
        <ChatPage onOpenModelSettings={onOpenModelSettings} />
      )}
    </div>
  );
}
