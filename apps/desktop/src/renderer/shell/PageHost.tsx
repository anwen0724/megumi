import { ChatPage } from '../features/chat';
import { DiscoveryPage } from '../features/discovery';
import type { DiscoveryRecommendationUiDto } from '@megumi/product-host/host';

export function PageHost({ page, onStartRecommendationConversation, onOpenContentSources }: {
  page: 'discovery' | 'chat';
  onStartRecommendationConversation: (recommendation: DiscoveryRecommendationUiDto) => void;
  onOpenContentSources: () => void;
}) {
  return (
    <div data-testid="page-host" className="relative flex min-h-0 flex-1 overflow-hidden">
      {page === 'discovery'
        ? <DiscoveryPage onStartConversation={onStartRecommendationConversation} onOpenContentSources={onOpenContentSources} />
        : <ChatPage />}
    </div>
  );
}
