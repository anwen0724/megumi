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
  'Session' + 'ActivePathRepository',
  'session_' + 'source_entries',
  'get' + 'ActivePath(',
  'get' + 'ActiveLeaf(',
  '@megumi/db',
];

const forbiddenProviderAndRendererSources = [
  'Session' + 'RunRepository',
  'Session' + 'ActivePathRepository',
  'timeline' + 'MessageRepository',
  'list' + 'CommittedMessagesBySession',
  'list' + 'MessagesBySession',
  'list' + 'RuntimeEventsByRun',
  'list' + 'StepsByRun',
  'get' + 'LatestCompletedSessionCompaction',
  'list' + 'SessionCompactionsBySession',
  'session_' + 'compactions',
  'session_' + 'source_entries',
  'session_' + 'active_leaves',
  'session_' + 'branch_markers',
  'create' + 'BranchFromUserMessage',
  'cancel' + 'BranchDraft',
  'get' + 'ActivePath(',
  'Session' + 'CompactionEntry',
  'list' + 'Tool',
];

const forbiddenSessionContextInputServiceCalls = [
  'list' + 'MessagesBySession',
  'list' + 'RunsBySession',
  'get' + 'LatestCompletedSessionCompaction',
  'list' + 'SessionCompactionsBySession',
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

  it('keeps compaction repository reads in desktop main and db repository boundaries', () => {
    const contextManagement = sourceUnder('packages/context-management');
    const providerAndRenderer = [
      sourceUnder('packages/ai'),
      sourceUnder('apps/desktop/src/renderer'),
    ].join('\n');

    expect(contextManagement).not.toContain('get' + 'LatestCompletedSessionCompaction');
    expect(contextManagement).not.toContain('session_' + 'compactions');
    expect(contextManagement).not.toContain('Session' + 'ActivePathRepository');
    expect(contextManagement).not.toContain('session_' + 'source_entries');
    expect(contextManagement).not.toContain('get' + 'ActivePath(');
    expect(contextManagement).not.toContain('get' + 'ActiveLeaf(');
    expect(contextManagement).not.toContain('@megumi/db');
    expect(providerAndRenderer).not.toContain('get' + 'LatestCompletedSessionCompaction');
    expect(providerAndRenderer).not.toContain('session_' + 'compactions');
    expect(providerAndRenderer).not.toContain('Session' + 'ActivePathRepository');
    expect(providerAndRenderer).not.toContain('session_' + 'source_entries');
    expect(providerAndRenderer).not.toContain('session_' + 'active_leaves');
    expect(providerAndRenderer).not.toContain('session_' + 'branch_markers');
    expect(providerAndRenderer).not.toContain('create' + 'BranchFromUserMessage');
    expect(providerAndRenderer).not.toContain('cancel' + 'BranchDraft');
    expect(providerAndRenderer).not.toContain('get' + 'ActivePath(');
    expect(providerAndRenderer).not.toContain('Session' + 'CompactionEntry');
  });

  it('keeps SessionContextInputService scoped to active path source selection', () => {
    const source = read('apps/desktop/src/main/services/session-context-input.service.ts');

    for (const forbidden of forbiddenSessionContextInputServiceCalls) {
      expect(source).not.toContain(forbidden);
    }
  });
});
