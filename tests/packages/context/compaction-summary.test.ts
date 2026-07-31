/* Verifies rolling Summary requests preserve prior Summary and exact structured Run facts. */
import { describe, expect, it } from 'vitest';
import type { ConversationRun } from '../../../packages/context/src/conversation-run';
import {
  buildCompactionSummaryRequest,
  COMPACTION_SUMMARY_SYSTEM_PROMPT,
} from '../../../packages/context/src/compaction/compaction-summary';

describe('buildCompactionSummaryRequest', () => {
  it('includes the prior Summary and renders attachments without embedding binary image content', () => {
    const run: ConversationRun = {
      source: {
        runId: 'run:1',
        userEntryId: 'entry:user',
        userMessageId: 'message:user',
        lastEntryId: 'entry:user',
        responseMessageRefs: [],
      },
      userMessage: {
        type: 'user_message',
        content: [
          { type: 'file', path: '/workspace/report.pdf', name: 'report.pdf' },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'binary' } },
        ],
      },
      items: [],
    };
    const request = buildCompactionSummaryRequest({ previousSummary: 'old facts', runs: [run] });
    expect(request.systemPrompt).toBe(COMPACTION_SUMMARY_SYSTEM_PROMPT);
    expect(request.input).toContain('old facts');
    expect(request.input).toContain('/workspace/report.pdf');
    expect(request.input).toContain('Image attachment included as structured content below');
    expect(request.input).not.toContain('binary');
  });
});
