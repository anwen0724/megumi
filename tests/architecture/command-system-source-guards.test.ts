// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const sourceExtensions = /\.(ts|tsx)$/;

function source(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function filesUnder(path: string): string[] {
  const absolute = join(repoRoot, path);
  if (!existsSync(absolute)) {
    return [];
  }

  return readdirSync(absolute).flatMap((entry) => {
    const child = join(absolute, entry);
    const relative = child.slice(repoRoot.length + 1).replaceAll('\\', '/');
    if (statSync(child).isDirectory()) {
      return filesUnder(relative);
    }

    return sourceExtensions.test(entry) ? [relative] : [];
  });
}

function offenders(paths: string[], forbidden: RegExp[]): string[] {
  const matches: string[] = [];
  for (const path of paths) {
    const text = source(path);
    for (const pattern of forbidden) {
      if (pattern.test(text)) {
        matches.push(`${path} matches ${pattern}`);
      }
    }
  }
  return matches;
}

describe('Command system source guards', () => {
  it('keeps provider adapters free of slash command parsing', () => {
    expect(offenders(filesUnder('packages/ai'), [
      /parseSlashCommand/,
      /dispatchCommandText/,
      /BUILT_IN_COMMANDS/,
      /workflow-command-contracts/,
      /\/review\b/,
    ])).toEqual([]);
  });

  it('keeps main runtime free of raw slash command parsing', () => {
    expect(offenders([
      'apps/desktop/src/main/services/session-run.service.ts',
      'apps/desktop/src/main/services/model-step-provider.service.ts',
      'apps/desktop/src/main/services/provider-runtime.service.ts',
    ], [
      /parseSlashCommand/,
      /dispatchCommandText/,
      /BUILT_IN_COMMANDS/,
      /listCommandSuggestions/,
      /\/review\b/,
    ])).toEqual([]);
  });

  it('keeps context management on structured workflow metadata only', () => {
    expect(offenders(filesUnder('packages/context-management'), [
      /parseSlashCommand/,
      /dispatchCommandText/,
      /BUILT_IN_COMMANDS/,
      /listCommandSuggestions/,
      /\/review\b/,
    ])).toEqual([]);
  });

  it('keeps review out of permission mode contracts', () => {
    const permissionModeContracts = source('packages/shared/permission-mode-contracts.ts');
    const runModeContracts = source('packages/shared/run-mode-contracts.ts');

    expect(permissionModeContracts).not.toMatch(/ACTIVE_PERMISSION_MODES[\s\S]*review/);
    expect(runModeContracts).not.toMatch(/PermissionModeSchema[\s\S]*review/);
    expect(permissionModeContracts).toContain('workflow_default');
  });

  it('keeps legacy agent switcher out of the chat command path', () => {
    expect(offenders([
      'apps/desktop/src/renderer/features/chat/components/Composer.tsx',
      'apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts',
      'apps/desktop/src/renderer/features/chat/layout/ChatLayout.tsx',
    ].filter((path) => existsSync(join(repoRoot, path))), [
      /AgentSwitcher/,
      /features\/agents/,
      /AgentType\.reviewer/,
    ])).toEqual([]);
  });
});
