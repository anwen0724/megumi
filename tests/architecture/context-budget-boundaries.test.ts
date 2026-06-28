// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walk(fullPath);
    }
    return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name) ? [fullPath] : [];
  });
}

function sourceUnder(relativeDirectory: string): string {
  return walk(path.join(root, relativeDirectory))
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
}

const oldModelInputPathNames = [
  'timeline' + 'MessagesToModelContext',
  'assistant' + 'StatusNote',
  'model' + 'ContextMessages',
  'history' + 'Messages',
];

describe('context budget and model input chain boundaries', () => {
  it('keeps coding-agent context builder APIs centered on ContextBudgetPolicy', () => {
    const source = [
      read('packages/coding-agent/context/model-input-context-builder.ts'),
      read('packages/coding-agent/context/model-call-context.ts'),
    ].join('\n');

    expect(source).toContain('budgetPolicy?: ContextBudgetPolicy');
    expect(source).not.toMatch(/\bmodelContextWindow\?:/);
    expect(source).not.toMatch(/\breservedOutputTokens\?:/);
    expect(source).not.toMatch(/\bavailableInputTokens\?:/);
    expect(source).not.toMatch(/\bkeepRecentTokens\?:/);
  });

  it('keeps coding-agent context independent from RunContext budget result inputs', () => {
    const source = read('packages/coding-agent/context/model-call-context.ts');

    expect(source).not.toContain('@megumi/shared/run');
    expect(source).not.toContain('runContext?:');
    expect(source).not.toContain('input.runContext');
    expect(source).not.toContain('?.budget.modelContextWindow');
    expect(source).not.toContain('?.budget.reservedOutputTokens');
  });

  it('keeps final budget decisions inside the context budget executor', () => {
    const sourceBuilders = [
      read('packages/coding-agent/context/model-call-context.ts'),
      read('packages/coding-agent/context/parts/session-context.ts'),
    ].join('\n');
    const budgetExecutor = read('packages/coding-agent/context/context-budget.ts');

    expect(sourceBuilders).not.toContain('budgetStatus:');
    expect(sourceBuilders).not.toContain('outside_recent_session_window');
    expect(budgetExecutor).toContain('budgetStatus');
    expect(budgetExecutor).toContain('outside_keep_recent_tokens');
  });

  it('keeps provider and renderer layers out of source selection and budget execution', () => {
    const source = [
      sourceUnder('packages/ai'),
      sourceUnder('apps/desktop/src/renderer'),
    ].join('\n');

    expect(source).not.toContain('apply' + 'ContextBudget');
    expect(source).not.toContain('Model' + 'InputContextPartDraft');
    expect(source).not.toContain('Context' + 'BudgetPolicy');
    expect(source).not.toContain('Session' + 'RunRepository');
    expect(source).not.toContain('timeline' + 'MessageRepository');
    expect(source).not.toContain('list' + 'CommittedMessagesBySession');
    expect(source).not.toContain('list' + 'MessagesBySession');
    expect(source).not.toContain('list' + 'RuntimeEventsByRun');
    expect(source).not.toContain('list' + 'StepsByRun');
    expect(source).not.toMatch(/from ['"]node:fs(?:\/[^'"]+)?['"]/);
    expect(source).not.toMatch(/from ['"]fs(?:\/[^'"]+)?['"]/);
  });

  it('keeps the context budget executor out of provider, renderer, main, and agent layers', () => {
    const source = [
      sourceUnder('packages/ai'),
      sourceUnder('apps/desktop/src/renderer'),
      sourceUnder('apps/desktop/src/main'),
      sourceUnder('packages/coding-agent/agent-loop/model-call'),
      sourceUnder('packages/coding-agent/run/loop'),
    ].join('\n');

    expect(source).not.toContain('apply' + 'ContextBudget');
    expect(source).not.toContain('@megumi/coding-agent/run/context/' + 'context-budget');
    expect(source).not.toMatch(/from ['"]@megumi\/coding-agent\/context\/context-budget['"]/);
    expect(source).not.toMatch(/from ['"]@megumi\/coding-agent\/context\/context-budget\.js['"]/);
  });

  it('keeps shared contracts free of budget algorithms and draft internals', () => {
    const source = sourceUnder('packages/shared');

    expect(source).not.toContain('apply' + 'ContextBudget');
    expect(source).not.toContain('estimate' + 'ModelInputContextTokens');
    expect(source).not.toContain('Model' + 'InputContextPartDraft');
  });

  it('keeps old model input path names out of packages and app code', () => {
    const source = [
      sourceUnder('packages'),
      sourceUnder('apps'),
    ].join('\n');

    for (const forbidden of oldModelInputPathNames) {
      expect(source).not.toContain(forbidden);
    }
  });
});
