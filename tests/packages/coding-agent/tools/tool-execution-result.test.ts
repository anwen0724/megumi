import { describe, expect, it } from 'vitest';
import {
  createCancelledToolResult,
  createFailedToolResult,
  normalizeRawToolResult,
} from '@megumi/coding-agent/tools/core/tool-execution-result';

describe('tool execution result normalization', () => {
  it('normalizes text raw results for model/context consumption', () => {
    const result = normalizeRawToolResult({
      toolName: 'read_file',
      rawResult: {
        outputKind: 'text',
        content: 'hello',
      },
    });

    expect(result).toMatchObject({
      type: 'succeeded',
      toolName: 'read_file',
      normalizedResult: {
        kind: 'text',
        content: 'hello',
        isError: false,
        truncated: false,
      },
      toolExecutionObservation: {
        summary: 'read_file completed',
      },
    });
  });

  it('creates failed results with normalized error content', () => {
    const result = createFailedToolResult({
      toolName: 'read_file',
      code: 'tool_execution_failed',
      message: 'File not found',
    });

    expect(result.type).toBe('failed');
    expect(result.normalizedResult).toMatchObject({
      kind: 'error',
      content: 'File not found',
      isError: true,
      truncated: false,
    });
  });

  it('creates cancelled results with tool_cancelled code', () => {
    const result = createCancelledToolResult({ toolName: 'run_command' });

    expect(result).toMatchObject({
      type: 'failed',
      error: {
        code: 'tool_cancelled',
      },
      normalizedResult: {
        kind: 'error',
        isError: true,
      },
    });
  });

  it('truncates oversized normalized content and records metadata', () => {
    const result = normalizeRawToolResult({
      toolName: 'read_file',
      rawResult: {
        outputKind: 'text',
        content: `${'x'.repeat(20_000)}secret-token`,
      },
    });

    expect(result.type).toBe('succeeded');
    expect(result.normalizedResult.truncated).toBe(true);
    expect(result.normalizedResult.truncationReason).toBe('byte_limit');
    expect(result.normalizedResult.content).not.toContain('secret-token');
    expect(result.normalizedResult.metadata).toMatchObject({
      redactionState: 'redacted',
    });
  });

  it('redacts common token, key, password, and secret values from normalized content', () => {
    const result = normalizeRawToolResult({
      toolName: 'run_command',
      rawResult: {
        outputKind: 'text',
        content: [
          'Authorization: Bearer abcdef1234567890',
          'apiKey=sk-test-1234567890abcdef',
          'password: raw-password-value',
          'secret: raw-secret-value',
        ].join('\n'),
      },
    });

    expect(result.type).toBe('succeeded');
    expect(result.normalizedResult.content).not.toContain('abcdef1234567890');
    expect(result.normalizedResult.content).not.toContain('sk-test-1234567890abcdef');
    expect(result.normalizedResult.content).not.toContain('raw-password-value');
    expect(result.normalizedResult.content).not.toContain('raw-secret-value');
    expect(result.normalizedResult.metadata).toMatchObject({
      redactionState: 'redacted',
    });
  });
});
