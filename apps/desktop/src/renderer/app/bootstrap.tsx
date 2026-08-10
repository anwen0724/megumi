/* Paints the static startup shell before loading the renderer's dependency graph. */
const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

const startupShell = document.getElementById('megumi-startup-shell');
const isCharacterWindow = new URLSearchParams(window.location.search).get('megumiWindowRole') === 'character';
if (isCharacterWindow) {
  document.documentElement.classList.add('megumi-character-window');
  startupShell?.remove();
}

void Promise.all([
  import('react-dom/client'),
  import('./renderer-bootstrap'),
  import('../shared/styles/globals.css'),
]).then(async ([{ createRoot }, { bootstrapRenderer }]) => {
  await bootstrapRenderer(createRoot(root));
  if (!startupShell) return;
  startupShell.classList.add('is-leaving');
  window.setTimeout(() => startupShell.remove(), 190);
}).catch((error: unknown) => {
  if (startupShell) {
    const caption = startupShell.querySelector('[data-startup-caption]');
    if (caption) {
      caption.textContent = error instanceof Error ? `Megumi failed to start: ${error.message}` : 'Megumi failed to start';
    }
  }
});
