import { useCallback, useState, type CSSProperties } from 'react';
import { ThemeProvider } from '../shared/theme';
import { AppBody } from '../shell/AppBody';
import { WindowTitleBar } from '../shell/WindowTitleBar';

export default function App() {
  const [title, setTitle] = useState('New session');
  const [workspaceSidebarOpen, setWorkspaceSidebarOpen] = useState(false);
  const [toggleWorkspaceSidebar, setToggleWorkspaceSidebar] = useState<(() => void) | undefined>();

  const handleToggleChange = useCallback((handler: (() => void) | undefined) => {
    setToggleWorkspaceSidebar(() => handler);
  }, []);

  return (
    <ThemeProvider>
      <div
        className="flex h-screen min-h-0 flex-col bg-[var(--color-app-bg)] text-[var(--color-text)]"
        style={{
          '--main-content-width': '42rem',
          '--right-sidebar-width': '20rem',
        } as CSSProperties}
      >
        <WindowTitleBar
          title={title}
          workspaceSidebarOpen={workspaceSidebarOpen}
          onToggleWorkspaceSidebar={toggleWorkspaceSidebar}
        />
        <AppBody
          onTitleChange={setTitle}
          onWorkspaceSidebarOpenChange={setWorkspaceSidebarOpen}
          onWorkspaceSidebarToggleChange={handleToggleChange}
        />
      </div>
    </ThemeProvider>
  );
}
