import { ChatPage } from '../features/chat';
import { SettingsPage } from './SettingsPage';

interface PageHostProps {
  settingsOpen: boolean;
  onCloseSettings: () => void;
}

export function PageHost({ settingsOpen, onCloseSettings }: PageHostProps) {
  return (
    <div data-testid="page-host" className="relative flex min-h-0 flex-1 overflow-hidden">
      {settingsOpen ? (
        <SettingsPage onDone={onCloseSettings} />
      ) : (
        <ChatPage />
      )}
    </div>
  );
}
