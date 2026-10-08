/* Keeps production readers aligned with the shared character-continuation contract. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { runConsolidationAgent } from '@megumi/application/memory/consolidation-agent';
import { selectConsolidationSources } from '@megumi/application/memory/consolidation-selection';
import { EMPTY_MEMORY, EMPTY_SUMMARY } from '@megumi/application/memory/consolidation-documents';
import { productionFixture } from './production-fixture';

it('reads the tail and finds a match past a long input line without skipping evidence', async () => {
  const f = productionFixture();
  let tail = '';
  let search = '';

  try {
    f.files.writeInput('raw_memories.md', ['x'.repeat(17000) + 'TAIL_EVIDENCE\n'], () => {});
    f.provider.setResponses([
      f.tool('memory_file', {
        action: 'read',
        path: 'raw_memories.md',
        startLine: 1,
        startCharacter: 16000,
      }),
      context => {
        tail = JSON.stringify(
          context.messages.filter(message => message.role === 'toolResult').at(-1),
        );
        return f.tool('memory_file', {
          action: 'search',
          query: 'TAIL_EVIDENCE',
        });
      },
      context => {
        search = JSON.stringify(
          context.messages.filter(message => message.role === 'toolResult').at(-1),
        );
        return f.tool('memory_file', {
          action: 'write',
          path: 'MEMORY.md',
          expectedVersion: 'absent',
          content: EMPTY_MEMORY,
        });
      },
      f.tool('memory_file', {
        action: 'write',
        path: 'memory_summary.md',
        expectedVersion: 'absent',
        content: EMPTY_SUMMARY,
      }),
      f.tool('memory_finish', {}),
    ]);
    await runConsolidationAgent({
      model: await f.options.resolveModel(),
      files: f.files,
      root: f.options.root,
      selection: selectConsolidationSources({
        database: f.database,
        sources: f.sources,
        configuration: f.config(),
        now: f.options.now(),
      }),
      signal: new AbortController().signal,
      guard: () => {},
    });

    expect(tail).toContain('TAIL_EVIDENCE');
    expect(search).toContain('raw_memories.md');
  } finally {
    await f.dispose();
  }
});
