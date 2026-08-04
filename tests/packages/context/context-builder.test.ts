/* Verifies Context.build reads Session History through the fixed ModelCallContext main chain. */
import { describe, expect, it, vi } from 'vitest';
import {
  createContext,
  type CreateContextOptions,
} from '../../../packages/context/src/index';
import {
  completedMessage,
  history,
  model,
  modelCall,
} from './context-test-fixtures';

function fixture(tokens = 50): CreateContextOptions {
  return {
    sessionHistory: {
      getActiveHistory: vi.fn(() => ({ status: 'ok' as const, history: history() })),
      saveCompactionSummary: vi.fn(),
    },
    attachmentReader: {
      readAttachmentContent: vi.fn(async () => ({
        status: 'failed' as const,
        failure: { code: 'attachment_not_found', message: 'not found' },
      })),
    },
    instructionReader: {
      getSystemInstructions: vi.fn(() => [{ instructionId: 'system', content: 'system' }]),
      getEffectiveInstructions: vi.fn(async () => ({
        status: 'ok' as const,
        instructions: {
          sources: [{ sourceId: 'agents', sourcePath: '/workspace/AGENTS.md', content: 'rules' }],
        },
      })),
    },
    models: { completeSimple: vi.fn(async () => completedMessage()) },
    contextTokenEstimator: vi.fn(() => tokens),
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
    ids: { compactionId: () => 'compaction:1' },
  };
}

describe('Context.build', () => {
  it('reads Session History and returns one provider-neutral Prompt', async () => {
    const options = fixture();
    const context = createContext(options);
    const result = await context.build({ modelCallContext: modelCall() });

    expect(options.sessionHistory.getActiveHistory).toHaveBeenCalledWith({
      session_id: 'session:1',
    });
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    // The systemPrompt follows the fixed order and carries the Execution Environment.
    const systemPrompt = result.prompt.systemPrompt ?? '';
    expect(systemPrompt).toContain('system');
    expect(systemPrompt).toContain('<effective_instructions>');
    expect(systemPrompt).toContain('/workspace/AGENTS.md');
    expect(systemPrompt).toContain('<execution_environment>');
    expect(systemPrompt).toContain('<working_directory>/workspace/packages/app</working_directory>');
    // No Skill Catalog section when the catalog is empty.
    expect(systemPrompt).not.toContain('<available_skills>');
    expect(result.prompt.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(result.prompt.tools).toEqual([]);
  });

  it('writes the Skill Catalog into the System Prompt without re-reading Skill content', async () => {
    const options = fixture();
    const result = await createContext(options).build({
      modelCallContext: modelCall({
        skills: {
          catalog: [{ name: 'review', description: 'Review', skillPath: '/skills/review/SKILL.md' }],
          diagnostics: [],
        },
      }),
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const systemPrompt = result.prompt.systemPrompt ?? '';
    expect(systemPrompt).toContain('<available_skills>');
    expect(systemPrompt).toContain('<name>review</name>');
    expect(systemPrompt).toContain('<location>/skills/review/SKILL.md</location>');
    // Explicit Skill body is never re-read by Context; it lives in the saved UserMessage.
    expect(JSON.stringify(result.prompt.messages)).not.toContain('Selected instructions.');
  });

  it('distinguishes cancellation, policy failure, and hard Context window exhaustion', async () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(await createContext(fixture()).build({
      modelCallContext: modelCall(),
      signal: aborted.signal,
    })).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });

    // An invalid policy for the Model Context Window is a configuration failure.
    expect(await createContext({ ...fixture(), policy: { reserveTokens: 500 } }).build({
      modelCallContext: modelCall({
        run: { ...modelCall().run, model: { ...model, contextWindow: 100 } },
      }),
    })).toMatchObject({ status: 'failed', failure: { code: 'policy_invalid' } });

    const exhausted: CreateContextOptions = {
      ...fixture(20_000),
    };
    expect(await createContext(exhausted).build({
      modelCallContext: modelCall(),
    })).toMatchObject({ status: 'failed', failure: { code: 'context_window_exceeded' } });
  });

  it('fails on invalid Tool Definitions without a generic build failure', async () => {
    const options = fixture();
    expect(await createContext(options).build({
      modelCallContext: modelCall({
        tools: { definitions: [{ name: 'broken' } as never] },
      }),
    })).toMatchObject({ status: 'failed', failure: { code: 'tool_definitions_invalid' } });
  });
});
