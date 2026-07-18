// Guards the persistence realignment so old table-shaped repositories cannot return.
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const forbiddenProductionStrings = [
  'class RunRecordRepository',
  'class ModelStepRepository',
  'class RuntimeEventRepository',
  'class RunExecutionFactRepository',
  'class RunContextRepository',
  'class RecoveryRepository',
  'class PermissionSnapshotRepository',
  'class TimelineMessageRepository',
  'class SessionRecordRepository',
  'class SessionMessageRepository',
  'class SessionActivePathRepository',
  'class SessionCompactionRepository',
  'class SessionContextRepository',
  'class ToolRepository',
  'class ProjectRepository',
  'LegacyModelStepEventRepository',
  'persistLegacyModelStepRecordFromEvent',
  'AgentRunRunRecordRepositoryPort',
  'AgentRunExecutionFactRepositoryPort',
  'AgentRunModelStepRepositoryPort',
  'AgentRunSessionContextRepositoryPort',
  'AgentRunRuntimeEventRepositoryPort',
  'ModelStepRecord',
  'saveModelStep(',
  'getModelStep(',
  'legacyModelSteps',
  'CompatFactKind',
  'saveCompatFact',
  'listCompatFacts',
  'compat:run_step',
  'compat:run_action',
  'compat:run_observation',
  'compat.run_step',
  'compat.run_action',
  'compat.run_observation',
  'compat.session_retry_attempt',
  'compat.session_interrupted_run_marker',
  'compat.session_branch_marker',
] as const;

const deletedTables = [
  'timeline_messages',
  'timeline_run_commits',
  'timeline_commit_diagnostics',
  'session_source_entries',
  'session_active_leaves',
  'session_branch_markers',
  'session_branches',
  'session_path_nodes',
  'session_retry_attempts',
  'session_interrupted_run_markers',
  'run_steps',
  'run_actions',
  'run_observations',
  'runtime_events',
  'run_context_baselines',
  'run_context_source_refs',
  'run_context_patches',
  'run_context_builds',
  'model_steps',
  'tool_registry_snapshot_entries',
  'tool_executions',
  'tool_results',
  'permission_decisions',
  'permission_snapshots',
  'approval_records',
  'tool_observations',
  'checkpoints',
  'resume_requests',
  'cancel_requests',
  'retry_requests',
  'checkpoint_restore_records',
  'workspace_snapshot_contents',
  'workspace_change_sets',
  'workspace_checkpoints',
  'workspace_restore_requests',
  'workspace_restore_results',
  'memory_candidates',
  'memory_source_refs',
  'memory_recall_requests',
  'memory_recall_results',
  'memory_access_logs',
  'memory_audit_logs',
  'artifact_relations',
  'implementation_plan_artifacts',
  'run_source_plans',
] as const;

const skippedDirectories = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

function containsDeletedTableReference(source: string, table: string): boolean {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(source);
}

describe('persistence code realignment source guards', () => {
  it('does not expose old table-shaped repository classes or ports in production source', () => {
    const violations = productionFiles('packages/agent').flatMap((file) => {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      return forbiddenProductionStrings
        .filter((forbidden) => source.includes(forbidden))
        .map((forbidden) => `${file} contains ${forbidden}`);
    });

    expect(violations).toEqual([]);
  });

  it('does not reference deleted product tables in production source', () => {
    const violations = productionFiles('packages/agent').flatMap((file) => {
      if (isAllowedDeletedTableReferenceFile(file)) {
        return [];
      }

      const source = fs.readFileSync(path.join(root, file), 'utf8');
      return deletedTables
        .filter((table) => containsDeletedTableReference(source, table))
        .map((table) => `${file} references deleted table ${table}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps persistence composition on database infrastructure and temporary legacy repositories only', () => {
    const source = fs.readFileSync(
      path.join(root, 'packages/agent/composition/compose-agent-persistence.ts'),
      'utf8',
    );

    for (const expected of [
      'memoryRepository',
      'artifactRepository',
    ]) {
      expect(source).toContain(expected);
    }

    for (const forbidden of [
      'workspaceRepository',
      'sessionRepository',
      'agentLoopRepository',
      'toolCallRepository',
      'workspaceChangeRepository',
      'runRecordRepository',
      'modelStepRepository',
      'runtimeEventRepository',
      'activePathRepository',
      'timelineMessageRepository',
      'permissionSnapshotRepository',
      'projectRepository',
      'toolRepository',
      'runContextRepository',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

function productionFiles(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) {
    return [];
  }

  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name) || entry.name.startsWith('.')) {
        return [];
      }
      return productionFiles(path.join(relativeDirectory, entry.name));
    }

    if (!/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      return [];
    }

    return [path.join(relativeDirectory, entry.name).replace(/\\/g, '/')];
  });
}

function isAllowedDeletedTableReferenceFile(file: string): boolean {
  return file === 'packages/agent/persistence/migrations/0000_database_foundation_redesign.sql';
}
