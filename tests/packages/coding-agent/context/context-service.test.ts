import { describe, expect, it, vi } from 'vitest';
import { ContextService, type ContextSessionFactRepository } from '@megumi/coding-agent/context';

function createRepository(overrides: Partial<ContextSessionFactRepository> = {}): ContextSessionFactRepository {
  return {
    listMessagesBySession: vi.fn(() => [
      {
        messageId: 'message:1',
        sessionId: 'session:1',
        role: 'user' as const,
        content: 'hello',
        status: 'completed',
        createdAt: '2026-07-03T00:00:00.000Z',
      },
    ]),
    listSessionCompactionsBySession: vi.fn(() => []),
    listRuntimeFactsBySession: vi.fn(() => []),
    listToolResultsBySession: vi.fn(() => []),
    ...overrides,
  };
}

describe('context service', () => {
  it('reads session messages and compaction summaries through repository ports', async () => {
    const repository = createRepository({
      listSessionCompactionsBySession: vi.fn(() => [{
        compactionId: 'compaction:1',
        summary: 'summary',
        status: 'completed' as const,
        createdAt: '2026-07-03T00:01:00.000Z',
      }]),
    });
    const service = new ContextService({
      repository,
      promptResources: { system_prompt: 'You are Megumi' },
    });

    const result = await service.getSessionContext({ session_id: 'session:1' });

    expect(result.status).toBe('ok');
    const sources = result.status === 'ok' ? result.session_context.sources : [];
    expect(sources.map((source) => source.source_kind)).toEqual([
      'session_message',
      'context_compaction_summary',
    ]);
  });

  it('reads included instruction snapshots as agent instruction sources', async () => {
    const instructionSource = {
      loadInstructionSources: vi.fn(async () => [{
        sourceId: 'instruction:AGENTS',
        status: 'included' as const,
        text: 'AGENTS.md content',
        relativePath: 'AGENTS.md',
        loadedAt: '2026-07-03T00:00:00.000Z',
      }]),
    };
    const service = new ContextService({
      repository: createRepository({ listMessagesBySession: vi.fn(() => []) }),
      instructionSource,
      promptResources: { system_prompt: 'You are Megumi' },
      clock: { now: () => '2026-07-03T00:00:00.000Z' },
    });

    const result = await service.getSessionContext({ session_id: 'session:1' });

    expect(result.status).toBe('ok');
    const sources = result.status === 'ok' ? result.session_context.sources : [];
    expect(sources).toContainEqual(expect.objectContaining({
      source_id: 'instruction:AGENTS',
      source_kind: 'agent_instruction',
      text: 'AGENTS.md content',
      persisted: false,
    }));
  });

  it('includes memory recall as non-persisted context source', async () => {
    const service = new ContextService({
      repository: createRepository({ listMessagesBySession: vi.fn(() => []) }),
      promptResources: { system_prompt: 'You are Megumi' },
    });

    const result = await service.getSessionContext({
      session_id: 'session:1',
      memory_recall: { memory_id: 'memory:1', text: 'remembered fact' },
    });

    expect(result.status).toBe('ok');
    const sources = result.status === 'ok' ? result.session_context.sources : [];
    expect(sources).toContainEqual(expect.objectContaining({
      source_id: 'memory:1',
      source_kind: 'memory_recall_result',
      persisted: false,
    }));
  });

  it('does not include provider state as context source', async () => {
    const service = new ContextService({
      repository: createRepository({
        listRuntimeFactsBySession: vi.fn(() => [{
          factId: 'runtime:1',
          text: 'safe runtime fact',
          metadata: { previous_response_id: 'resp_123' },
        }]),
      }),
      promptResources: { system_prompt: 'You are Megumi' },
    });

    const result = await service.getSessionContext({ session_id: 'session:1' });

    expect(result.status).toBe('ok');
    const serialized = JSON.stringify(result.status === 'ok' ? result.session_context.sources : []);
    expect(serialized).not.toContain('resp_123');
  });

  it('buildPrompt does not call repository ports and writes exact prompt messages', () => {
    const repository = createRepository();
    const promptLog = { writePrompt: vi.fn() };
    const service = new ContextService({
      repository,
      promptResources: { system_prompt: 'You are Megumi' },
      promptLog,
      clock: { now: () => '2026-07-03T00:00:00.000Z' },
      ids: { promptId: () => 'prompt:1' },
    });

    const result = service.buildPrompt({
      session_context: {
        session_id: 'session:1',
        sources: [{
          source_id: 'message:current',
          source_kind: 'session_message',
          text: 'current request',
          persisted: true,
          metadata: { role: 'user' },
        }],
      },
      purpose: 'agent_response',
      current_user_message_id: 'message:current',
    });

    expect(result.status).toBe('ok');
    expect(repository.listMessagesBySession).not.toHaveBeenCalled();
    const prompt = result.status === 'ok' ? result.prompt : undefined;
    expect(promptLog.writePrompt).toHaveBeenCalledWith({
      prompt_id: 'prompt:1',
      purpose: 'agent_response',
      session_id: 'session:1',
      messages: prompt?.messages,
      created_at: '2026-07-03T00:00:00.000Z',
    });
  });

  it('returns invalid_session_context for missing session id', () => {
    const service = new ContextService({
      repository: createRepository(),
      promptResources: { system_prompt: 'You are Megumi' },
    });

    const result = service.buildPrompt({
      session_context: { session_id: '', sources: [] },
      purpose: 'agent_response',
    });

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'invalid_session_context',
    });
  });

  it('returns missing_required_prompt_part when required prompt parts cannot be built', () => {
    const service = new ContextService({
      repository: createRepository(),
      promptResources: { system_prompt: 'You are Megumi' },
    });

    const result = service.buildPrompt({
      session_context: {
        session_id: 'session:1',
        sources: [{
          source_id: 'instruction:empty',
          source_kind: 'agent_instruction',
          text: '',
          persisted: false,
        }],
      },
      purpose: 'agent_response',
    });

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'missing_required_prompt_part',
    });
  });
});
