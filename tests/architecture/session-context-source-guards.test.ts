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
  'session_' + 'retry_attempts',
  'session_' + 'interrupted_run_markers',
  'list' + 'RecoverableRuns(',
  'mark' + 'InterruptedRuns(',
  'classify' + 'AutomaticModelStepRetry(',
  'get' + 'ActivePath(',
  'get' + 'ActiveLeaf(',
  '@megumi/db',
];

const forbiddenProviderSources = [
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
  'session_' + 'retry_attempts',
  'session_' + 'interrupted_run_markers',
  'mark' + 'InterruptedRuns(',
  'classify' + 'AutomaticModelStepRetry(',
  'create' + 'BranchFromUserMessage',
  'cancel' + 'BranchDraft',
  'get' + 'ActivePath(',
  'Session' + 'CompactionEntry',
  'list' + 'Tool',
];

const forbiddenRendererSourceSelectionSources = [
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
  'session_' + 'retry_attempts',
  'session_' + 'interrupted_run_markers',
  'mark' + 'InterruptedRuns(',
  'classify' + 'AutomaticModelStepRetry(',
  'create' + 'BranchFromUserMessage',
  'get' + 'ActivePath(',
  'Session' + 'CompactionEntry',
  'list' + 'Tool',
];

const forbiddenWorkspaceChangePersistenceSources = [
  'Workspace' + 'ChangeRepository',
  'Workspace' + 'RestoreService',
  'workspace_' + 'changed_files',
  'workspace_' + 'checkpoints',
  'workspace_' + 'restore_requests',
  'workspace_' + 'snapshot_contents',
  'current_' + 'hash_mismatch',
  'restore' + 'ModifiedFile',
  'restore' + 'CreatedFile',
  'restore' + 'DeletedFile',
];

const forbiddenSessionContextInputServiceCalls = [
  'list' + 'MessagesBySession',
  'list' + 'RunsBySession',
  'get' + 'LatestCompletedSessionCompaction',
  'list' + 'SessionCompactionsBySession',
];

describe('session context source guards', () => {
  it('keeps old timeline/modelContext projection out of SessionRunService model input path', () => {
    const source = read('apps/desktop/src/main/services/session/session-run.service.ts');

    for (const forbidden of forbiddenSessionRunNames) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('requires coding-agent context callers to pass explicit sessionContext instead of legacy history message inputs', () => {
    const source = [
      read('packages/coding-agent/context/context-budget.ts'),
      read('packages/coding-agent/context/model-input-context-builder.ts'),
      read('packages/coding-agent/context/model-step-input-context.ts'),
      read('packages/coding-agent/context/session-compaction.ts'),
    ].join('\n');

    for (const forbidden of forbiddenContextManagementNames) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('keeps provider and renderer layers from selecting session context sources', () => {
    const providerSource = sourceUnder('packages/ai');
    const rendererSource = sourceUnder('apps/desktop/src/renderer');

    for (const forbidden of forbiddenProviderSources) {
      expect(providerSource).not.toContain(forbidden);
    }

    for (const forbidden of forbiddenRendererSourceSelectionSources) {
      expect(rendererSource).not.toContain(forbidden);
    }
  });

  it('keeps renderer provider and coding-agent context away from workspace change persistence', () => {
    const contextManagement = sourceUnder('packages/coding-agent/context');
    const provider = sourceUnder('packages/ai');
    const renderer = sourceUnder('apps/desktop/src/renderer');

    for (const source of [contextManagement, provider, renderer]) {
      for (const forbidden of forbiddenWorkspaceChangePersistenceSources) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it('keeps compaction repository reads in desktop main and db repository boundaries', () => {
    const contextManagement = sourceUnder('packages/coding-agent/context');
    const provider = sourceUnder('packages/ai');
    const renderer = sourceUnder('apps/desktop/src/renderer');

    expect(contextManagement).not.toContain('session_' + 'compactions');
    expect(contextManagement).not.toContain('session_' + 'source_entries');
    expect(contextManagement).not.toContain('session_' + 'retry_attempts');
    expect(contextManagement).not.toContain('session_' + 'interrupted_run_markers');
    expect(contextManagement).not.toContain('list' + 'RecoverableRuns(');
    expect(contextManagement).not.toContain('mark' + 'InterruptedRuns(');
    expect(contextManagement).not.toContain('classify' + 'AutomaticModelStepRetry(');
    expect(contextManagement).not.toContain('@megumi/db');
    for (const source of [provider, renderer]) {
      expect(source).not.toContain('get' + 'LatestCompletedSessionCompaction');
      expect(source).not.toContain('session_' + 'compactions');
      expect(source).not.toContain('Session' + 'ActivePathRepository');
      expect(source).not.toContain('session_' + 'source_entries');
      expect(source).not.toContain('session_' + 'active_leaves');
      expect(source).not.toContain('session_' + 'branch_markers');
      expect(source).not.toContain('session_' + 'retry_attempts');
      expect(source).not.toContain('session_' + 'interrupted_run_markers');
      expect(source).not.toContain('mark' + 'InterruptedRuns(');
      expect(source).not.toContain('classify' + 'AutomaticModelStepRetry(');
      expect(source).not.toContain('create' + 'BranchFromUserMessage');
      expect(source).not.toContain('get' + 'ActivePath(');
      expect(source).not.toContain('Session' + 'CompactionEntry');
    }
    expect(provider).not.toContain('cancel' + 'BranchDraft');
  });

  it('keeps SessionContextInputService scoped to active path source selection', () => {
    const source = read('packages/coding-agent/session/session-context-input.ts');

    for (const forbidden of forbiddenSessionContextInputServiceCalls) {
      expect(source).not.toContain(forbidden);
    }
  });
});
