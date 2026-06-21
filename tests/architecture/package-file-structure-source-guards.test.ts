// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const sourceExtensions = /\.(ts|tsx)$/;

function read(path: string): string {
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

function productionFiles(): string[] {
  return [
    ...filesUnder('packages'),
    ...filesUnder('apps/desktop/src'),
  ];
}

function offenders(paths: string[], forbidden: RegExp[]): string[] {
  const output: string[] = [];

  for (const path of paths) {
    const text = read(path);
    for (const pattern of forbidden) {
      if (pattern.test(text)) {
        output.push(`${path} matches ${pattern}`);
      }
    }
  }

  return output;
}

describe('package and file structure source guards', () => {
  it('keeps shared contracts in semantic domain directories', () => {
    expect(existsSync(join(repoRoot, 'packages/shared/runtime/events.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/tool/contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/input/contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/input/command-contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/input/preprocessing-contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/hook/contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/skill/contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/prompt-template/contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/session/agent-profile-contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/agent'))).toBe(false);

    expect(filesUnder('packages/shared').filter((path) => /packages\/shared\/[^/]+-contracts\.ts$/.test(path))).toEqual([]);
    expect(filesUnder('packages/shared').filter((path) => /packages\/shared\/runtime-[^/]+\.ts$/.test(path))).toEqual([]);
  });

  it('keeps production code off old flat shared import paths', () => {
    expect(offenders(productionFiles(), [
      /@megumi\/shared\/agent-contracts/,
      /@megumi\/shared\/artifact-contracts/,
      /@megumi\/shared\/chat-stream-event-factory/,
      /@megumi\/shared\/chat-stream-event-schemas/,
      /@megumi\/shared\/chat-stream-events/,
      /@megumi\/shared\/chat-stream-to-timeline-projection/,
      /@megumi\/shared\/context-budget-contracts/,
      /@megumi\/shared\/input-command-contracts/,
      /@megumi\/shared\/ipc-channels/,
      /@megumi\/shared\/ipc-contracts/,
      /@megumi\/shared\/ipc-errors/,
      /@megumi\/shared\/ipc-schemas/,
      /@megumi\/shared\/memory-contracts/,
      /@megumi\/shared\/model-contracts/,
      /@megumi\/shared\/model-input-context-contracts/,
      /@megumi\/shared\/model-step-contracts/,
      /@megumi\/shared\/permission-mode-contracts/,
      /@megumi\/shared\/permission-settings-contracts/,
      /@megumi\/shared\/permission-snapshot-contracts/,
      /@megumi\/shared\/project-contracts/,
      /@megumi\/shared\/provider-contracts/,
      /@megumi\/shared\/recovery-contracts/,
      /@megumi\/shared\/run-context-contracts/,
      /@megumi\/shared\/run-contracts/,
      /@megumi\/shared\/runtime-context/,
      /@megumi\/shared\/runtime-errors/,
      /@megumi\/shared\/runtime-event-factory/,
      /@megumi\/shared\/runtime-event-schemas/,
      /@megumi\/shared\/runtime-events/,
      /@megumi\/shared\/runtime-request/,
      /@megumi\/shared\/runtime-result/,
      /@megumi\/shared\/runtime-validation/,
      /@megumi\/shared\/session-active-path-contracts/,
      /@megumi\/shared\/session-compaction-contracts/,
      /@megumi\/shared\/session-context-contracts/,
      /@megumi\/shared\/session-run-contracts/,
      /@megumi\/shared\/timeline-message-block-schemas/,
      /@megumi\/shared\/timeline-message-blocks/,
      /@megumi\/shared\/tool-contracts/,
      /@megumi\/shared\/workspace-change-contracts/,
      /@megumi\/shared\/workspace-file-contracts/,
    ])).toEqual([]);
  });

  it('removes the temporary input command compatibility shim after input foundation migration', () => {
    expect(existsSync(join(repoRoot, 'packages/shared/input-command'))).toBe(false);
  });

  it('keeps generic Agent Runtime under packages/agent', () => {
    expect(existsSync(join(repoRoot, 'packages/agent/loop/agent-loop.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/agent/model/model-step.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/agent/model/model-step-event-adapter.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/agent/model/model-step-provider-adapter.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/agent/events/runtime-event-factory.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/agent/state/state-policy.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/core', 'agent-runtime'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/core/ports/ai-port.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/ai', 'compat'))).toBe(false);

    expect(offenders(productionFiles(), [
      /@megumi\/core\/run-runtime/,
      /@megumi\/core\/runtime-exception/,
      /@megumi\/core\/runtime-assert/,
    ])).toEqual([]);
  });

  it('keeps desktop main services grouped by host backend domain', () => {
    const flatServiceFiles = readdirSync(join(repoRoot, 'apps/desktop/src/main/services'))
      .filter((entry) => entry.endsWith('.service.ts'));

    expect(flatServiceFiles).toEqual([]);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/main/services/session/session-run.service.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/main/services/runtime/model-step-provider.service.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/main/services/tool/tool-executors/read-file.executor.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/main/services/settings/app-settings.service.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/main/services/security/secret-store.service.ts'))).toBe(false);
  });
});
