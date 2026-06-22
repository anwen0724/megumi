import { describe, expect, it } from 'vitest';
import { createRuleBasedPermissionClassifier } from '@megumi/coding-agent/permissions/permission-classifier';

describe('rule-based permission classifier', () => {
  const classifier = createRuleBasedPermissionClassifier();

  it('returns an object with classify(input)', () => {
    expect(classifier).toEqual({ classify: expect.any(Function) });
  });

  it('allows ordinary project-local reads, edits, and verification in auto', () => {
    expect(classifier.classify({
      permissionMode: 'auto',
      toolName: 'read_file',
      capability: 'project_read',
      sideEffect: 'none',
      commandLabel: undefined,
      projectPath: { insideProject: true, protected: false, sensitive: false },
    })).toMatchObject({
      decision: 'allow',
      classifierLabel: 'read_only',
      confidence: expect.any(Number),
      reason: expect.any(String),
    });

    expect(classifier.classify({
      permissionMode: 'auto',
      toolName: 'write_file',
      capability: 'project_write',
      sideEffect: 'project_file_operation',
      commandLabel: undefined,
      projectPath: { insideProject: true, protected: false, sensitive: false },
    })).toMatchObject({
      decision: 'allow',
      classifierLabel: 'project_file_operation',
      confidence: expect.any(Number),
      reason: expect.any(String),
    });

    expect(classifier.classify({
      permissionMode: 'auto',
      toolName: 'write_file',
      capability: 'project_write',
      sideEffect: 'project_file_operation',
      commandLabel: undefined,
    })).toMatchObject({
      decision: 'ask',
      classifierLabel: 'project_file_operation',
      confidence: expect.any(Number),
      reason: expect.any(String),
    });

    expect(classifier.classify({
      permissionMode: 'auto',
      toolName: 'edit_file',
      capability: 'project_write',
      sideEffect: 'none',
      commandLabel: undefined,
    })).toMatchObject({
      decision: 'ask',
      classifierLabel: 'project_file_operation',
      confidence: expect.any(Number),
      reason: expect.any(String),
    });

    expect(classifier.classify({
      permissionMode: 'auto',
      toolName: 'run_command',
      capability: 'command_run',
      sideEffect: 'execute_command',
      commandLabel: 'verification',
      projectPath: { insideProject: true, protected: false, sensitive: false },
    })).toMatchObject({
      decision: 'allow',
      classifierLabel: 'verification',
      confidence: expect.any(Number),
      reason: expect.any(String),
    });
  });

  it('asks or denies risky auto actions without bypass-style decisions', () => {
    expect(classifier.classify({
      permissionMode: 'auto',
      toolName: 'write_file',
      capability: 'project_write',
      sideEffect: 'project_file_operation',
      projectPath: { insideProject: true, protected: true, sensitive: false },
    })).toMatchObject({ decision: 'deny', classifierLabel: 'project_boundary' });

    expect(classifier.classify({
      permissionMode: 'auto',
      toolName: 'write_file',
      capability: 'project_write',
      sideEffect: 'project_file_operation',
      projectPath: { insideProject: true, protected: false, sensitive: true },
    })).toMatchObject({ decision: 'ask', classifierLabel: 'sensitive_policy' });

    expect(classifier.classify({
      permissionMode: 'auto',
      toolName: 'write_file',
      capability: 'project_write',
      sideEffect: 'project_file_operation',
      projectPath: { insideProject: false, protected: false, sensitive: false },
    })).toMatchObject({ decision: 'deny', classifierLabel: 'project_boundary' });

    for (const commandLabel of [
      'network',
      'git_mutation',
      'dependency_install',
      'secret_or_env',
      'unknown',
    ] as const) {
      expect(classifier.classify({
        permissionMode: 'auto',
        toolName: 'run_command',
        capability: 'command_run',
        sideEffect: 'execute_command',
        commandLabel,
        projectPath: { insideProject: true, protected: false, sensitive: false },
      }).decision).toBe('ask');
    }

    expect(classifier.classify({
      permissionMode: 'auto',
      toolName: 'run_command',
      capability: 'command_run',
      sideEffect: 'execute_command',
      commandLabel: 'destructive',
      projectPath: { insideProject: true, protected: false, sensitive: false },
    }).decision).toBe('deny');

    expect(classifier.classify({
      permissionMode: 'auto',
      toolName: 'run_command',
      capability: 'command_run',
      sideEffect: 'execute_command',
      commandLabel: 'infrastructure_or_deploy',
      projectPath: { insideProject: true, protected: false, sensitive: false },
    }).decision).toBe('deny');
  });
});
