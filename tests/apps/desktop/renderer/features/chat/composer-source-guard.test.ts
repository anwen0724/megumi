// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../../..');

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function sourceFilesUnder(path: string): string[] {
  const absolutePath = resolve(repoRoot, path);
  const stats = statSync(absolutePath);

  if (stats.isFile()) {
    return [path];
  }

  return readdirSync(absolutePath)
    .flatMap((entry) => {
      const childPath = `${path}/${entry}`;
      const childStats = statSync(resolve(repoRoot, childPath));

      if (childStats.isDirectory()) {
        return sourceFilesUnder(childPath);
      }

      return /\.(?:ts|tsx)$/.test(entry) ? [childPath] : [];
    });
}

function readJsxTextAndStringProps(source: string): string {
  const jsxText = Array.from(source.matchAll(/>\s*([^<>{}\n][^<>{}]*)\s*</g), (match) => match[1]);
  const stringProps = Array.from(source.matchAll(/\b(?:aria-label|placeholder|label|title)=["']([^"']+)["']/g), (match) => match[1]);
  const stringLabels = Array.from(source.matchAll(/\blabel:\s*["']([^"']+)["']/g), (match) => match[1]);

  return [...jsxText, ...stringProps, ...stringLabels].join('\n');
}

function readTabLabels(source: string): string[] {
  return Array.from(source.matchAll(/\blabel:\s*["']([^"']+)["']/g), (match) => match[1]);
}

describe('composer source guard', () => {
  it('keeps renderer composer from constructing model-visible input preprocessing', () => {
    const offenders = sourceFilesUnder('apps/desktop/src/renderer')
      .filter((file) => {
        const source = readSource(file);
        return source.includes('InputPreprocessingResult')
          || source.includes('createInputPreprocessingSubmitPayload')
          || source.includes("kind: 'prompt_template'")
          || source.includes("kind: 'skill'");
      });

    expect(offenders).toEqual([]);
  });

  it('keeps shortcut hints and running draft explanations out of persistent composer copy', () => {
    const composer = readSource('apps/desktop/src/renderer/features/chat/components/Composer.tsx');
    const composerSurface = readSource('apps/desktop/src/renderer/features/chat/components/ComposerSurface.tsx');
    const commandSuggestionPanel = readSource('apps/desktop/src/renderer/features/chat/components/CommandSuggestionPanel.tsx');
    const composerCopy = readJsxTextAndStringProps(`${composer}\n${composerSurface}\n${commandSuggestionPanel}`);

    expect(`${composer}\n${composerSurface}\n${commandSuggestionPanel}`).not.toMatch(/Shift\s*\+\s*Enter|Alt\s*\+\s*Enter/i);
    expect(composerCopy).not.toMatch(/\bshortcut\b/i);
    expect(`${composer}\n${composerSurface}\n${commandSuggestionPanel}`).not.toMatch(/next message after this run/i);
  });

  it('does not move composer mode or model controls into the titlebar', () => {
    const titlebar = readSource('apps/desktop/src/renderer/shell/WindowTitleBar.tsx');

    expect(titlebar).not.toMatch(/Composer mode|Model|deepseek|gpt-|claude-/i);
  });

  it('does not introduce a right panel Run tab from composer work', () => {
    const rightSidebar = readSource('apps/desktop/src/renderer/shell/RightSidebar.tsx');

    expect(readTabLabels(rightSidebar)).not.toContain('Run');
  });

  it('keeps composer toolbar controls on one line', () => {
    const composer = readSource('apps/desktop/src/renderer/features/chat/components/ComposerSurface.tsx');

    expect(composer).toMatch(/data-testid="composer-toolbar" className="[^"]*\bflex-nowrap\b/);
    expect(composer).not.toMatch(/data-testid="composer-toolbar" className="[^"]*\bflex-wrap\b/);
    expect(composer).not.toMatch(/data-testid="composer-toolbar"[\s\S]*?\bflex-wrap\b[\s\S]*?aria-label="Send message"/);
    expect(composer).toMatch(/data-testid="composer-actions"[\s\S]*className="[^"]*\bshrink-0\b/);
    expect(composer).toMatch(/label="Send message"[\s\S]*className="[^"]*\bshrink-0\b/);
    expect(composer).toMatch(/label="Stop current run"[\s\S]*className="[^"]*\bshrink-0\b/);
    expect(composer).not.toMatch(/<SendHorizontal[^>]*\/>\s*Send/);
    expect(composer).not.toMatch(/<Square[^>]*\/>\s*Stop/);
  });

  it('keeps composer in ComposerDock and message scrolling in MessageScrollPanel', () => {
    const chatPage = readSource('apps/desktop/src/renderer/features/chat/pages/ChatPage.tsx');
    const messageScrollPanel = readSource('apps/desktop/src/renderer/features/chat/layout/MessageScrollPanel.tsx');
    const composerDock = readSource('apps/desktop/src/renderer/features/chat/layout/ComposerDock.tsx');
    const composerOverlayLayer = readSource('apps/desktop/src/renderer/features/chat/layout/ComposerOverlayLayer.tsx');
    const messageColumn = readSource('apps/desktop/src/renderer/features/chat/layout/MessageColumn.tsx');

    expect(chatPage).toContain('<ChatViewport');
    expect(chatPage).toContain('<ComposerDock');
    expect(chatPage).not.toContain('<ChatArea');
    expect(chatPage).not.toContain('<ComposerArea');
    expect(messageScrollPanel).toContain('data-testid="message-scroll-panel"');
    expect(messageScrollPanel).toContain('overflow-y-auto');
    expect(messageColumn).toContain('data-testid="message-column"');
    expect(messageColumn).toContain('<BottomSpacer');
    expect(composerDock).toContain('data-testid="composer-dock"');
    expect(composerDock).toContain('data-testid="composer-dock-column"');
    expect(composerDock).not.toContain('data-testid="composer-dock-content"');
    expect(composerDock).toContain('bg-transparent');
    expect(composerDock).toContain('pb-3');
    expect(composerDock).not.toContain('bg-transparent px-6');
    expect(messageColumn).toContain('w-[calc(100%-3rem)]');
    expect(messageColumn).toContain('max-w-[var(--chat-column-width)]');
    expect(messageColumn).not.toContain('px-6');
    expect(composerDock).toContain('w-[calc(100%-3rem)]');
    expect(composerDock).toContain('max-w-[var(--chat-composer-width)]');
    expect(composerDock).not.toContain('px-6');
    expect(composerDock).toContain('<ComposerOverlayLayer');
    expect(composerDock).toContain('<ComposerSurface');
    expect(composerDock.indexOf('<ComposerOverlayLayer')).toBeLessThan(composerDock.indexOf('<ComposerSurface'));
    expect(composerOverlayLayer).toContain('data-testid="composer-overlay-layer"');
    expect(composerOverlayLayer).toContain('absolute');
    expect(composerOverlayLayer).toContain('bottom-[calc(100%+0.5rem)]');
    expect(chatPage).not.toContain('chat-composer-dock');
    expect(chatPage).not.toContain('chat-message-scroll-area');
  });

  it('keeps command suggestion UI presentation-only until a trusted catalog is wired in', () => {
    const commandPanel = readSource('apps/desktop/src/renderer/features/chat/components/CommandSuggestionPanel.tsx');

    expect(commandPanel).not.toContain('BUILT_IN_INPUT_COMMAND_REGISTRY');
    expect(commandPanel).not.toContain('listInputCommandSuggestions');
    expect(commandPanel).not.toContain('InputPreprocessingResult');
    expect(commandPanel).not.toContain("kind: 'prompt_template'");
    expect(commandPanel).not.toContain("kind: 'skill'");
  });

  it('keeps renderer command suggestions off core command implementation details', () => {
    const rendererSources = [
      readSource('apps/desktop/src/renderer/features/chat/components/Composer.tsx'),
      readSource('apps/desktop/src/renderer/features/chat/components/ComposerSurface.tsx'),
      readSource('apps/desktop/src/renderer/features/chat/components/CommandSuggestionPanel.tsx'),
      readSource('apps/desktop/src/renderer/features/chat/hooks/use-composer-controller.ts'),
      readSource('apps/desktop/src/renderer/features/chat/layout/ComposerDock.tsx'),
    ].join('\n');

    expect(rendererSources).not.toContain('createCommandCatalog');
    expect(rendererSources).not.toContain('built_in_commands');
    expect(rendererSources).not.toContain('parseSlashCommandInput');
    expect(rendererSources).not.toContain('handleCommandInput');
  });
});
