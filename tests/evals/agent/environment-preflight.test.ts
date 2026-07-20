/* Verifies Evaluation refuses capabilities that the selected environment cannot isolate. */
import { describe, expect, it } from 'vitest';
import { EvaluationCaseSchema } from '../../../evals/agent/cases/evaluation-case';
import { ExecutionProfileSchema } from '../../../evals/agent/config/execution-profile';
import { preflightEvaluationEnvironment } from '../../../evals/agent/runner/environment-preflight';

const baseCase = EvaluationCaseSchema.parse({
  schemaVersion: 1,
  caseId: 'file-task',
  name: 'File task',
  description: 'Writes a file.',
  tags: ['coding'],
  request: { text: 'Write answer.md.' },
  requirements: { tools: ['write_file'], minimumIsolation: 'workspace_only' },
  graders: [{ graderId: 'file', type: 'file_exists', required: true, config: { path: 'answer.md' } }],
});

describe('Evaluation environment preflight', () => {
  it('allows scoped file tools in workspace-only isolation', () => {
    const profile = ExecutionProfileSchema.parse({
      profileId: 'files', name: 'Files', environmentKind: 'controlled', permissionMode: 'full_access',
      enabledTools: ['read_file', 'write_file'], networkAccess: 'disabled', isolation: 'workspace_only',
      limits: { wallClockMs: 10_000 },
    });
    expect(preflightEvaluationEnvironment({
      evaluationCase: baseCase,
      profile,
      resolvedTools: profile.enabledTools ?? [],
      availableIsolation: ['workspace_only'],
    })).toEqual({ status: 'ok' });
  });

  it('rejects commands even when workspace-only mode uses full access', () => {
    const profile = ExecutionProfileSchema.parse({
      profileId: 'unsafe', name: 'Unsafe', environmentKind: 'controlled', permissionMode: 'full_access',
      enabledTools: ['run_command'], networkAccess: 'disabled', isolation: 'workspace_only',
      limits: { wallClockMs: 10_000 },
    });
    const commandCase = { ...baseCase, requirements: { tools: ['run_command'], minimumIsolation: 'os_sandbox' as const } };
    const result = preflightEvaluationEnvironment({
      evaluationCase: commandCase,
      profile,
      resolvedTools: ['run_command'],
      availableIsolation: ['workspace_only'],
    });
    expect(result.status).toBe('setup_failed');
    expect(result).toMatchObject({ issues: expect.arrayContaining([expect.stringMatching(/isolation|run_command/i)]) });
  });

  it('rejects missing tools and live-network requirements before execution', () => {
    const profile = ExecutionProfileSchema.parse({
      profileId: 'offline', name: 'Offline', environmentKind: 'controlled', permissionMode: 'ask',
      enabledTools: [], networkAccess: 'disabled', isolation: 'workspace_only',
      limits: { wallClockMs: 10_000 },
    });
    const result = preflightEvaluationEnvironment({
      evaluationCase: {
        ...baseCase,
        requirements: { tools: ['web_search'], networkAccess: 'live' as const },
      },
      profile,
      resolvedTools: [],
      availableIsolation: ['workspace_only'],
    });
    expect(result.status).toBe('setup_failed');
    expect(result).toMatchObject({ issues: expect.arrayContaining([expect.stringMatching(/web_search/), expect.stringMatching(/network/i)]) });
  });
});
