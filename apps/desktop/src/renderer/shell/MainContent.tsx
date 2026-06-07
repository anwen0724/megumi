import { MainOverlays } from './MainOverlays';
import { PageHost } from './PageHost';

interface MainContentProps {
  settingsOpen: boolean;
  onCloseSettings: () => void;
}

export function MainContent({ settingsOpen, onCloseSettings }: MainContentProps) {
  return (
    <main
      data-testid="main-content"
      className="relative flex min-h-0 min-w-[var(--main-content-width)] flex-1 overflow-hidden transition-[width] duration-200 ease-out"
    >
      <PageHost settingsOpen={settingsOpen} onCloseSettings={onCloseSettings} />
      <MainOverlays />
    </main>
  );
}
