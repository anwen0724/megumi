import { ChatPage } from '../features/chat';
import { DiscoveryPage } from '../features/discovery';
import type { DiscoveryRecommendationUiDto } from '@megumi/product/host';

export function PageHost({ page, onStartRecommendationConversation }: {
  page: 'discovery' | 'chat';
  onStartRecommendationConversation: (recommendation: DiscoveryRecommendationUiDto) => void;
}) {
  return (
    <div data-testid="page-host" className="relative flex min-h-0 flex-1 overflow-hidden">
      {page === 'discovery'
        ? <DiscoveryPage onStartConversation={onStartRecommendationConversation} />
        : <ChatPage />}
    </div>
  );
}
