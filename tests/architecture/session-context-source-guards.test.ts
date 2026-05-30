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

const forbiddenSessionRunNames = [
  'timeline' + 'MessagesToModelContext',
  'assistant' + 'AnswerContextMessages',
  'assistant' + 'StatusNote',
  'format' + 'FailedTurnStatusNote',
  'model' + 'ContextMessages',
];

const forbiddenContextManagementNames = [
  'history' + 'Messages',
];

const forbiddenProviderAndRendererSources = [
  'Session' + 'RunRepository',
  'timeline' + 'MessageRepository',
  'list' + 'CommittedMessagesBySession',
  'list' + 'MessagesBySession',
  'list' + 'RuntimeEventsByRun',
  'list' + 'StepsByRun',
  'list' + 'Tool',
];

describe('session context source guards', () => {
  it('keeps old timeline/modelContext projection out of SessionRunService model input path', () => {
    const source = read('apps/desktop/src/main/services/session-run.service.ts');

    for (const forbidden of forbiddenSessionRunNames) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('requires context-management callers to pass explicit sessionContext instead of legacy history message inputs', () => {
    const source = sourceUnder('packages/context-management');

    for (const forbidden of forbiddenContextManagementNames) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('keeps provider and renderer layers from selecting session context sources', () => {
    const source = [
      sourceUnder('packages/ai'),
      sourceUnder('apps/desktop/src/renderer'),
    ].join('\n');

    for (const forbidden of forbiddenProviderAndRendererSources) {
      expect(source).not.toContain(forbidden);
    }
  });
});
