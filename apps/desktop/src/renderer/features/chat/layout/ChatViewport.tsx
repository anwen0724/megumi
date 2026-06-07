import type { ComponentProps } from 'react';
import { WelcomeChat } from '../components/WelcomeChat';
import { MessageColumn } from './MessageColumn';
import { MessageScrollPanel } from './MessageScrollPanel';

interface ChatViewportProps {
  hasTimelineContent: boolean;
  welcome: ComponentProps<typeof WelcomeChat>;
  scrollPanel: Omit<ComponentProps<typeof MessageScrollPanel>, 'children'>;
  messageColumn: ComponentProps<typeof MessageColumn>;
}

export function ChatViewport({
  hasTimelineContent,
  welcome,
  scrollPanel,
  messageColumn,
}: ChatViewportProps) {
  return (
    <div data-testid="chat-viewport" className="relative h-full min-h-0">
      {hasTimelineContent ? (
        <MessageScrollPanel {...scrollPanel}>
          <MessageColumn {...messageColumn} />
        </MessageScrollPanel>
      ) : (
        <WelcomeChat {...welcome} />
      )}
    </div>
  );
}
