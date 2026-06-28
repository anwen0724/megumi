import { describe, expect, it } from 'vitest';
import { toolResultModelInputParts } from '@megumi/coding-agent/context';
import type { ToolResult } from '@megumi/shared/tool';

function toolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    toolResultId: 'tool-result:1',
    toolCallId: 'tool-call:1',
    toolExecutionId: 'tool-execution:1',
    observationId: 'observation:1',
    runId: 'run:1',
    kind: 'success',
    textContent: 'small result',
    redactionState: 'none',
    createdAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('tool result model input parts', () => {
  it('uses a bounded observation envelope instead of passing huge tool text through required context', () => {
    const huge = `${'x'.repeat(30_000)}UNBOUNDED_SENTINEL`;
    const parts = toolResultModelInputParts({
      builtAt: '2026-06-15T00:00:01.000Z',
      toolResults: [toolResult({
        textContent: huge,
        metadata: {
          observationTruncated: true,
          observationTruncationReason: 'byteLimit',
          observationRawResultRef: 'raw-result:1',
          observationContinuationHint: 'Use a narrower file range.',
          observationByteLength: 100_000,
          observationTokenEstimate: 25_000,
        },
      })],
    });

    const resultPart = parts.find((part) => (
      part.kind === 'tool_continuation'
      && 'toolResultId' in part
      && part.toolResultId === 'tool-result:1'
    )) as ({ text: string; toolResultContent?: unknown } | undefined);
    expect(resultPart).toBeDefined();
    expect(resultPart?.text).toContain('Tool result tool-result:1 for tool-call:1');
    expect(resultPart?.text).toContain('Observation truncated: true');
    expect(resultPart?.text).toContain('Raw result ref: raw-result:1');
    expect(resultPart?.text).toContain('Use a narrower file range.');
    expect(resultPart?.text).not.toContain('UNBOUNDED_SENTINEL');
    expect(String(resultPart?.toolResultContent).length).toBeLessThan(15_000);
    expect(String(resultPart?.toolResultContent)).not.toContain('UNBOUNDED_SENTINEL');
  });
});
