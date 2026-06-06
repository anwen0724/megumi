import { ChatTimeline } from '../components/ChatTimeline';

export function ChatPage() {
  return (
    <div data-testid="chat-page-root" className="min-h-0 flex-1">
      <ChatTimeline />
    </div>
  );
}
