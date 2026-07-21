import { describe, expect, it } from 'vitest';
import {
  createCancelledToolResult,
  createFailedToolResult,
  normalizeRawToolResult,
} from '@megumi/agent/tools/core/tool-execution-result';

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
      details: { reason: 'not_found' },
    });

    expect(result.type).toBe('failed');
    expect(result.normalizedResult).toMatchObject({
      kind: 'error',
      isError: true,
      truncated: false,
    });
    expect(JSON.parse(result.normalizedResult.content)).toEqual({
      code: 'tool_execution_failed',
      message: 'File not found',
      details: { reason: 'not_found' },
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
    expect(result.normalizedResult.content).toContain('this tool output exceeded the safety limit');
    expect(result.normalizedResult.content).toContain('Do not treat the following content as complete.');
    expect(Buffer.byteLength(result.normalizedResult.content, 'utf8')).toBeLessThanOrEqual(12_000);
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
          'apiKey=TEST_RUNTIME_API_KEY',
          'password: raw-password-value',
          'secret: raw-secret-value',
        ].join('\n'),
      },
    });

    expect(result.type).toBe('succeeded');
    expect(result.normalizedResult.content).not.toContain('abcdef1234567890');
    expect(result.normalizedResult.content).not.toContain('TEST_RUNTIME_API_KEY');
    expect(result.normalizedResult.content).not.toContain('raw-password-value');
    expect(result.normalizedResult.content).not.toContain('raw-secret-value');
    expect(result.normalizedResult.metadata).toMatchObject({
      redactionState: 'redacted',
    });
  });

  it('keeps structured adapter failure facts and bounded output in model-visible content', () => {
    const result = normalizeRawToolResult({
      toolName: 'run_command',
      rawResult: {
        outputKind: 'command',
        content: { stdoutPreview: '', stderrPreview: 'compile failed' },
        isError: true,
        error: {
          code: 'tool_execution_failed',
          message: 'Command exited with code 2.',
          details: { reason: 'non_zero_exit', exitCode: 2 },
        },
      },
    });

    expect(result).toMatchObject({
      type: 'failed',
      error: {
        code: 'tool_execution_failed',
        message: 'Command exited with code 2.',
        details: { reason: 'non_zero_exit', exitCode: 2 },
      },
    });
    expect(JSON.parse(result.normalizedResult.content)).toEqual({
      code: 'tool_execution_failed',
      message: 'Command exited with code 2.',
      details: { reason: 'non_zero_exit', exitCode: 2 },
      output: { stdoutPreview: '', stderrPreview: 'compile failed' },
    });
  });
});
