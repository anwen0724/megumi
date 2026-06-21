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

function productionSourceFiles(): string[] {
  return [
    ...filesUnder('packages'),
    ...filesUnder('apps/desktop/src'),
  ].filter((path) => !path.includes('/archive/'));
}

function rendererProductionFiles(): string[] {
  return filesUnder('apps/desktop/src/renderer');
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
  it('keeps generic command primitives in renderer shared and input definitions in the input feature', () => {
    expect(existsSync(join(repoRoot, 'apps/desktop/src/renderer/shared/commands/command-parser.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/renderer/shared/commands/command-dispatcher.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/renderer/shared/commands/command-types.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/renderer/features/input/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/renderer/features/input/commands/built-in-input-commands.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/renderer/features/input/preprocessing/input-preprocessing-submit.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/renderer/features/input-commands'))).toBe(false);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/renderer/features/workflow-commands'))).toBe(false);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/renderer/features/commands'))).toBe(false);
  });

  it('keeps shared command primitives free of intent-specific business contracts', () => {
    expect(offenders(filesUnder('apps/desktop/src/renderer/shared/commands'), [
      /workflow-command-contracts/,
      /input-command-contracts/,
      /createCodeReview/,
      /\/review\b/,
      /workflow_default/,
      /intent_default/,
    ])).toEqual([]);
  });

  it('allows chat to consume input commands only through their public API', () => {
    expect(offenders([
      'apps/desktop/src/renderer/features/chat/components/Composer.tsx',
      'apps/desktop/src/renderer/features/chat/components/CommandSuggestionPanel.tsx',
      'apps/desktop/src/renderer/features/chat/hooks/use-composer-controller.ts',
      'apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts',
    ], [
      /features\/commands/,
      /features\/workflow-commands/,
      /features\/input\/(?!index)/,
      /features\/input-commands/,
      /\.\.\/\.\.\/commands/,
      /\.\.\/input\/(?!index)/,
      /\.\.\/input-commands/,
      /\.\.\/workflow-commands/,
    ])).toEqual([]);
  });

  it('keeps the input feature from depending on chat internals', () => {
    expect(offenders(filesUnder('apps/desktop/src/renderer/features/input'), [
      /features\/chat/,
      /\.\.\/chat/,
    ])).toEqual([]);
  });

  it('keeps production renderer code off the old input-commands feature path', () => {
    expect(offenders(rendererProductionFiles(), [
      /features\/input-commands/,
      /\.\.\/input-commands/,
      /@megumi\/shared\/input-command/,
    ])).toEqual([]);
  });

  it('keeps production code off legacy input command contracts and legacy context intent handoff', () => {
    const productionText = productionSourceFiles()
      .map((relativePath) => source(relativePath))
      .join('\n');

    expect(productionText).not.toContain('@megumi/shared/input-command');
    expect(productionText).not.toContain('packages/shared/input-command');
    expect(productionText).not.toContain('context?.intent');
    expect(productionText).not.toContain('context.intent');
    expect(productionText).not.toContain('payload.intent');
    expect(productionText).not.toContain('inputIntent');
  });

  it('keeps required input preprocessing boundary comments in production code', () => {
    expect(source('apps/desktop/src/main/services/runtime/runtime-input.service.ts'))
      .toContain('before session runs trust it');
    expect(source('packages/coding-agent/context/model-step-input-context.ts'))
      .toContain('never parses raw slash commands');
    expect(source('apps/desktop/src/main/services/session/session-run.service.ts'))
      .toContain('runtime normalization is the trust boundary');
    expect(source('packages/shared/ipc/schemas.ts'))
      .toContain('runtime services own trusted normalization');
    expect(source('apps/desktop/src/renderer/features/input/preprocessing/input-preprocessing-submit.ts'))
      .toContain('instead of expanding provider-visible text in the renderer');
    expect(source('apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts'))
      .toContain('Desktop Main is responsible for validating it');
  });

  it('keeps provider adapters free of slash command parsing and input command business semantics', () => {
    expect(offenders(filesUnder('packages/ai'), [
      /parseSlashCommand/,
      /dispatchCommandText/,
      /BUILT_IN_INPUT_COMMAND/,
      /workflow-command-contracts/,
      /input-command-contracts/,
      /\/review\b/,
    ])).toEqual([]);
  });

  it('keeps main runtime free of raw slash command parsing', () => {
    expect(offenders([
      'apps/desktop/src/main/services/session/session-run.service.ts',
      'apps/desktop/src/main/services/runtime/model-step-provider.service.ts',
      'apps/desktop/src/main/services/provider/provider-runtime.service.ts',
    ], [
      /parseSlashCommand/,
      /dispatchCommandText/,
      /BUILT_IN_INPUT_COMMAND/,
      /listCommandSuggestions/,
      /\/review\b/,
    ])).toEqual([]);
  });

  it('keeps context management free of raw slash command parsing', () => {
    expect(offenders(filesUnder('packages/coding-agent/context'), [
      /parseSlashCommand/,
      /dispatchCommandText/,
      /BUILT_IN_INPUT_COMMAND/,
      /listCommandSuggestions/,
      /workflow-command-contracts/,
      /\/review\b/,
    ])).toEqual([]);
  });

  it('does not keep legacy workflow command bridge in production code', () => {
    const forbidden = [
      /workflow-command-contracts/,
      /\bWorkflowCommand/,
      /\bworkflow_default\b/,
      /\bcontext\?\.workflow\b/,
      /\bcontext\.workflow\b/,
      /\bpayload\.workflow\b/,
    ];
    const allowed = new Set([
      'packages/shared/memory/contracts.ts',
      'packages/memory/index.ts',
    ]);

    for (const relative of productionSourceFiles()) {
      if (allowed.has(relative)) {
        continue;
      }
      const text = source(relative);
      for (const pattern of forbidden) {
        expect(text, `${relative} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('keeps review out of permission mode contracts and exposes intent_default as a command-derived permission source', () => {
    const permissionModeContracts = source('packages/shared/permission/mode-contracts.ts');

    expect(permissionModeContracts).not.toMatch(/ACTIVE_PERMISSION_MODES[\s\S]*review/);
    expect(permissionModeContracts).toContain('intent_default');
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
