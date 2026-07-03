import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function sourceUnder(relativePath: string): string {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    return '';
  }
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  return entries.map((entry) => {
    const child = path.join(relativePath, entry.name);
    return entry.isDirectory() ? sourceUnder(child) : read(child);
  }).join('\n');
}

describe('context system source guards', () => {
  it('uses the target context module structure', () => {
    const allowedTopLevelEntries = [
      'contracts',
      'core',
      'index.ts',
      'services',
    ];
    const actualTopLevelEntries = fs.readdirSync(path.join(root, 'packages/coding-agent/context')).sort();

    expect(actualTopLevelEntries).toEqual(allowedTopLevelEntries);
    expect(exists('packages/coding-agent/context/contracts/context-contracts.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/contracts/context-usage-contracts.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/contracts/context-compaction-contracts.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/services/context-service.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/services/context-usage-monitor.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/services/context-compaction-service.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/core/prompt-builder.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/core/session-context-usage.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/core/prompt-parts.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/core/context-compaction.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/adapters')).toBe(false);
    expect(exists('packages/coding-agent/context/compaction')).toBe(false);
    expect(exists('packages/coding-agent/context/instructions')).toBe(false);
    expect(exists('packages/coding-agent/context/parts')).toBe(false);
    expect(exists('packages/coding-agent/context/resources')).toBe(false);
    expect(exists('packages/coding-agent/context/model-call-context.ts')).toBe(false);
    expect(exists('packages/coding-agent/context/model-call-input-builder.ts')).toBe(false);
    expect(exists('packages/coding-agent/context/model-input-context-builder.ts')).toBe(false);
    expect(exists('packages/coding-agent/context/model-input-source-overrides.ts')).toBe(false);
    expect(exists('packages/coding-agent/context/context-budget.ts')).toBe(false);
    expect(exists('packages/coding-agent/context/initial-model-input-preparation.ts')).toBe(false);
  });

  it('does not expose old model input context concepts from the context public index', () => {
    const publicIndex = read('packages/coding-agent/context/index.ts');

    expect(publicIndex).not.toContain('model-input-context-builder');
    expect(publicIndex).not.toContain('model-call-input-builder');
    expect(publicIndex).not.toContain('context-budget');
    expect(publicIndex).not.toContain('SessionCompactionOrchestrator');
    expect(publicIndex).not.toContain('./core/');
    expect(publicIndex).not.toContain('PromptPart');
  });

  it('keeps provider continuation state out of context contracts', () => {
    const contracts = sourceUnder('packages/coding-agent/context/contracts');

    expect(contracts).not.toContain('provider_state');
    expect(contracts).not.toContain('previous_response_id');
    expect(contracts).not.toContain('conversation_id');
    expect(contracts).not.toContain('export type PromptPart');
  });

  it('keeps prompt-builder independent from filesystem loading', () => {
    const promptBuilder = read('packages/coding-agent/context/core/prompt-builder.ts');

    expect(promptBuilder).not.toContain('node:fs');
    expect(promptBuilder).not.toContain('fs.readFile');
    expect(promptBuilder).toContain('prompt_resources');
  });
});
