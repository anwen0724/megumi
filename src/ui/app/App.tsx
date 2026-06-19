import { type CSSProperties } from 'react';
import { ThemeProvider } from '../shared/theme';
import { AppBody } from '../shell/AppBody';
import { WindowTitleBar } from '../shell/WindowTitleBar';

export default function App() {
  return (
    <ThemeProvider>
      <div
        className="flex h-screen min-h-0 flex-col bg-[var(--color-app-bg)] text-[var(--color-text)]"
        style={{
          '--main-content-width': '42rem',
          '--right-sidebar-width': '20rem',
        } as CSSProperties}
      >
        <WindowTitleBar />
        <AppBody />
      </div>
    </ThemeProvider>
  );
}
