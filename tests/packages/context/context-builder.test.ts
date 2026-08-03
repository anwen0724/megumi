/* Verifies Context.build reads Session History through the fixed ModelCallContext main chain. */
import type { Api, Model } from '@megumi/ai';
import { describe, expect, it, vi } from 'vitest';
import {
  createContext,
  type CreateContextOptions,
  type ModelCallContext,
  type RunContext,
} from '../../../packages/context/src/index';
import type { SessionHistoryItem } from '@megumi/session';

const model: Model<Api> = {
  id: 'gpt',
  name: 'GPT',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 20_000,
  maxTokens: 20,
};

function history(): SessionHistoryItem[] {
  return [
    {
      type: 'message',
      entry: {
        entry_id: 'entry:user',
        session_id: 'session:1',
        entry_type: 'message',
        message_id: 'message:user',
        created_at: 'now',
      },
      message: {
        message_id: 'message:user',
        session_id: 'session:1',
        run_id: 'run:old',
        message_kind: 'user_message',
        display_content: [{ type: 'text', text: 'before' }],
        model_content: [{ type: 'text', text: 'before' }],
        created_at: 'now',
      },
      attachments: [],
    },
    {
      type: 'message',
      entry: {
        entry_id: 'entry:assistant',
        session_id: 'session:1',
        parent_entry_id: 'entry:user',
        entry_type: 'message',
        message_id: 'message:assistant',
        created_at: 'now',
      },
      message: {
        message_id: 'message:assistant',
        session_id: 'session:1',
        run_id: 'run:old',
        message_kind: 'assistant_reply',
        status: 'completed',
        content: [{ type: 'text', text: 'done' }],
        created_at: 'now',
      },
      attachments: [],
    },
  ];
}

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

function modelCall(overrides: Partial<ModelCallContext> = {}): ModelCallContext {
  const run: RunContext = {
    runId: 'run:current',
    sessionId: 'session:1',
    workspaceId: 'workspace:1',
    userInput: {
      displayContent: [{ type: 'text', text: 'now' }],
      modelContent: [{ type: 'text', text: 'now' }],
      attachments: [],
    },
    model,
  };
  return {
    modelCallId: 'model-call:1',
    run,
    executionEnvironment: {
      workingDirectory: '/workspace/packages/app',
      operatingSystem: 'Linux',
      shell: 'POSIX shell',
    },
    effectiveInstructions: {
      sources: [{ sourceId: 'agents', sourcePath: '/workspace/AGENTS.md', content: 'rules' }],
    },
    skills: { catalog: [], diagnostics: [] },
    tools: { definitions: [] },
    ...overrides,
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

function completedMessage() {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: 'summary' }],
    api: 'openai-completions' as const,
    provider: 'openai' as const,
    model: 'gpt',
    usage: {
      input: 0,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: 0,
  };
}
