/* Verifies rolling Summary requests preserve prior Summary and exact structured Message facts. */
import { describe, expect, it } from 'vitest';
import type { Message } from '@megumi/ai';
import {
  buildCompactionSummaryRequest,
  COMPACTION_SUMMARY_SYSTEM_PROMPT,
} from '../../../packages/context/src/compaction/compaction-summary-generator';

describe('buildCompactionSummaryRequest', () => {
  it('includes the prior Summary and renders attachments without embedding binary image content', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'task with /workspace/report.pdf' },
          { type: 'image', data: 'binary', mimeType: 'image/png' },
        ],
        timestamp: 0,
      },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call:1', name: 'read_file', arguments: { path: '/workspace/report.pdf' } }],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt',
        stopReason: 'toolUse',
        timestamp: 0,
      },
    ];
    const request = buildCompactionSummaryRequest({ previousSummary: 'old facts', messages });
    expect(request.systemPrompt).toBe(COMPACTION_SUMMARY_SYSTEM_PROMPT);
    expect(request.input).toContain('old facts');
    expect(request.input).toContain('/workspace/report.pdf');
    expect(request.input).toContain('Image attachment included as structured content below');
    expect(request.input).not.toContain('binary');
  });
});
