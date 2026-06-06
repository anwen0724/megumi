import type { ComponentProps } from 'react';
import { MessageScrollPanel } from './MessageScrollPanel';
import { MessageColumn } from './MessageColumn';
import { WelcomeChat } from './WelcomeChat';

interface ChatAreaProps {
  hasTimelineContent: boolean;
  welcome: ComponentProps<typeof WelcomeChat>;
  scrollPanel: Omit<ComponentProps<typeof MessageScrollPanel>, 'children'>;
  messageColumn: ComponentProps<typeof MessageColumn>;
}

export function ChatArea({ hasTimelineContent, welcome, scrollPanel, messageColumn }: ChatAreaProps) {
  return (
    <div data-testid="chat-area" className="h-full min-h-0">
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
