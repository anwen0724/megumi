import { describe, expect, it } from 'vitest';
import {
  WorkflowCommandMetadataSchema,
  createCodeReviewWorkflowCommandMetadata,
} from '@megumi/shared/workflow-command-contracts';

describe('workflow-command-contracts', () => {
  it('parses the built-in code review workflow metadata', () => {
    expect(WorkflowCommandMetadataSchema.parse({
      intent: 'code_review',
      source: 'builtin_command',
      commandName: 'review',
      argsText: '当前改动',
    })).toEqual({
      intent: 'code_review',
      source: 'builtin_command',
      commandName: 'review',
      argsText: '当前改动',
    });
  });

  it('rejects mismatched review workflow command names', () => {
    expect(() => WorkflowCommandMetadataSchema.parse({
      intent: 'code_review',
      source: 'builtin_command',
      commandName: 'reviewx',
      argsText: '',
    })).toThrow();
  });

  it('creates normalized code review workflow metadata', () => {
    expect(createCodeReviewWorkflowCommandMetadata(' 重点看测试 ')).toEqual({
      intent: 'code_review',
      source: 'builtin_command',
      commandName: 'review',
      argsText: '重点看测试',
    });
  });
});
