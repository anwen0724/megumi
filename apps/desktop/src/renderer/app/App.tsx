import { ThemeProvider } from '../shared/theme';
import { AppShell } from '../shell/AppShell';

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
