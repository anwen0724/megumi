import { describe, expect, it } from 'vitest';
import { mapToolExecutionResultToRuntimeFact } from '@megumi/agent/agent-run/core/tool-result-mapper';

describe('Agent Run tool result mapper', () => {
  it('passes normalized content, observation, and runtime sources without reading raw content', () => {
    const result = mapToolExecutionResultToRuntimeFact({
      tool_call_id: 'tool-call-1',
      tool_name: 'read_file',
      created_at: '2026-07-21T00:00:00.000Z',
      result: {
        type: 'succeeded',
        toolName: 'read_file',
        rawResult: { outputKind: 'text', content: 'raw content must not be projected' },
        normalizedResult: {
          kind: 'text', content: 'normalized model content', isError: false, truncated: false,
        },
        toolExecutionObservation: { summary: 'read_file completed' },
        runtimeSources: [{
          source_id: 'source-1', source_kind: 'file', text: 'source text', persisted: false,
        }],
      },
    });

    expect(result).toEqual({
      tool_call_id: 'tool-call-1',
      tool_name: 'read_file',
      status: 'success',
      content: 'normalized model content',
      observation: { summary: 'read_file completed' },
      runtimeSources: [{
        source_id: 'source-1', source_kind: 'file', text: 'source text', persisted: false,
      }],
      created_at: '2026-07-21T00:00:00.000Z',
    });
  });

  it('passes the existing structured failure unchanged', () => {
    const result = mapToolExecutionResultToRuntimeFact({
      tool_call_id: 'tool-call-2',
      tool_name: 'run_command',
      created_at: '2026-07-21T00:00:00.000Z',
      result: {
        type: 'failed',
        toolName: 'run_command',
        error: {
          code: 'tool_execution_failed',
          message: 'Command exited with code 2.',
          details: { reason: 'non_zero_exit', exitCode: 2 },
        },
        normalizedResult: {
          kind: 'error', content: '{"exitCode":2}', isError: true, truncated: false,
        },
      },
    });

    expect(result).toMatchObject({
      status: 'failure',
      content: '{"exitCode":2}',
      error: {
        code: 'tool_execution_failed',
        details: { reason: 'non_zero_exit', exitCode: 2 },
      },
    });
  });
});
