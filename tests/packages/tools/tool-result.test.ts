/* Tests the internal normalization fallback without exposing raw adapter results publicly. */

import { describe, expect, it } from 'vitest';
import {
  createCancelledToolResult,
  createFailedToolResult,
  isSuccessfulToolExecutionResult,
  normalizeRawToolResult,
} from '../../../packages/tools/src/tool-result';

describe('Tool result normalization', () => {
  it('preserves structured effects on both successful and failed results', () => {
    const effectReport = {
      coverage: 'complete' as const,
      effects: [{ type: 'modified' as const, path: { location: 'workspace' as const, path: 'notes.md' }, pathType: 'file' as const }],
      itemFailures: [],
    };
    const success = normalizeRawToolResult({
      toolName: 'edit_file',
      rawResult: { outputKind: 'json', content: { changed: true }, effectReport },
    });
    const failure = normalizeRawToolResult({
      toolName: 'copy_path',
      rawResult: {
        outputKind: 'error',
        content: 'copy failed',
        isError: true,
        error: { code: 'path_conflict', message: 'Destination exists.' },
        effectReport,
      },
    });

    expect(success.effectReport).toEqual(effectReport);
    expect(failure.effectReport).toEqual(effectReport);
  });
  it('redacts, bounds, and hides the raw adapter value', () => {
    const result = normalizeRawToolResult({
      toolName: 'run_command',
      rawResult: {
        outputKind: 'text',
        content: `apiKey=secret-token\n${'x'.repeat(20_000)}`,
      },
    });
    expect(isSuccessfulToolExecutionResult(result)).toBe(true);
    expect(result).not.toHaveProperty('rawResult');
    expect(result.normalizedResult.truncated).toBe(true);
    expect(result.normalizedResult.content).not.toContain('secret-token');
    expect(Buffer.byteLength(result.normalizedResult.content, 'utf8')).toBeLessThanOrEqual(12_000);
    expect(result.normalizedResult.truncationReason).toBe('byte_limit');
    expect(result.normalizedResult.content).toContain('Do not treat the following content as complete.');
    expect(result.normalizedResult.metadata).toMatchObject({ redactionState: 'redacted' });
  });

  it('normalizes successful text without exposing the raw Adapter result', () => {
    const result = normalizeRawToolResult({
      toolName: 'read_file',
      rawResult: { outputKind: 'text', content: 'hello' },
    });
    expect(result).toMatchObject({
      type: 'succeeded',
      toolName: 'read_file',
      normalizedResult: {
        kind: 'text', content: 'hello', isError: false, truncated: false,
      },
      observation: { summary: 'read_file completed' },
    });
    expect(result).not.toHaveProperty('rawResult');
  });

  it('creates bounded structured failures and cancellation results', () => {
    const failed = createFailedToolResult({
      toolName: 'read_file',
      code: 'tool_execution_failed',
      message: 'File not found',
      details: { reason: 'not_found' },
    });
    expect(failed).toMatchObject({
      type: 'failed',
      error: {
        code: 'tool_execution_failed',
        message: 'File not found',
        details: { reason: 'not_found' },
      },
      normalizedResult: { kind: 'error', isError: true, truncated: false },
    });
    expect(JSON.parse(failed.normalizedResult.content)).toEqual({
      toolName: 'read_file',
      code: 'tool_execution_failed',
      message: 'File not found',
      details: { reason: 'not_found' },
    });

    expect(createCancelledToolResult({ toolName: 'run_command' })).toMatchObject({
      type: 'failed',
      error: { code: 'tool_cancelled' },
      normalizedResult: { kind: 'error', isError: true },
    });
  });

  it('keeps structured Adapter failure facts and bounded output', () => {
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
