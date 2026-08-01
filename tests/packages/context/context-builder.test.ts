/* Verifies Context.build reads owner facts and returns one provider-neutral immutable projection. */
import { Type, type Api, type AssistantMessage, type Model } from '@megumi/ai';
import { describe, expect, it, vi } from 'vitest';
import {
  createContext,
  type CreateContextOptions,
  type CurrentConversationRun,
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
  contextWindow: 100,
  maxTokens: 20,
};

const currentRun: CurrentConversationRun = {
  runId: 'run:current',
  userEntry: { entryId: 'entry:current', parentEntryId: 'entry:assistant' },
  userMessage: { type: 'user_message', content: [{ type: 'text', text: 'now' }] },
  runItems: [{ type: 'assistant_message', content: [{ type: 'text', text: 'working' }] }],
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
        content: [{ type: 'text', text: 'before' }],
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
        reason_code: 'normal_completion',
        content: [{ type: 'text', text: 'done' }],
        created_at: 'now',
        completed_at: 'now',
      },
      attachments: [],
    },
  ];
}

function completedMessage(content = 'summary'): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 0,
  };
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
    scopeResolver: {
      resolve: vi.fn(() => ({
        status: 'resolved' as const,
        workspaceRoot: '/workspace',
        executionEnvironment: {
          workingDirectory: '/workspace/packages/app',
          operatingSystem: 'Linux',
          shell: 'POSIX shell',
        },
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
    ids: { preparationId: () => 'preparation:1', compactionId: () => 'compaction:1' },
  };
}

describe('Context.build', () => {
  it('loads Session and Instructions at build time and returns Context, Tools, usage, and sources', async () => {
    const options = fixture();
    const context = createContext(options);
    const result = await context.build({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      currentRun,
      tools: [{ name: 'read_file', description: 'Read a file', parameters: Type.Object({}) }],
      model,
    });

    expect(options.sessionHistory.getActiveHistory).toHaveBeenCalledWith({
      session_id: 'session:1',
      through_entry_id: 'entry:assistant',
    });
    expect(options.instructionReader.getEffectiveInstructions).toHaveBeenCalledWith(
      { workspaceRoot: '/workspace', workingDirectory: '/workspace/packages/app' },
      undefined,
    );
    expect(result).toMatchObject({
      status: 'ready',
      prepared: {
        preparationId: 'preparation:1',
        usage: { usedTokens: 50, contextWindowTokens: 100 },
        context: { systemPrompt: expect.stringContaining('Working directory: /workspace/packages/app'), tools: [{ name: 'read_file' }] },
      },
    });
    if (result.status === 'ready') {
      expect(result.prepared.context.messages.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(result.prepared.sourceRefs).toEqual(expect.arrayContaining([
        { sourceType: 'system_instruction', sourceId: 'system' },
        { sourceType: 'agent_instruction', sourceId: 'agents' },
        { sourceType: 'tool_definition', sourceId: 'read_file' },
      ]));
    }
  });

  it('loads catalog, selected Skill, and use_skill runtime sources without a Tools dependency', async () => {
    const options: CreateContextOptions = {
      ...fixture(20),
      skillServiceFactory: vi.fn(() => ({
      getSkillCatalog: vi.fn(async () => ({
        status: 'ok' as const,
        skills: [{ name: 'review', description: 'Review', skillPath: '/skills/review/SKILL.md' }],
      })),
      useSkill: vi.fn(async () => ({
        status: 'ok' as const,
        skill: {
          name: 'selected',
          skillPath: '/skills/selected/SKILL.md',
          content: 'Selected instructions.',
        },
      })),
      })),
    };
    const result = await createContext(options).build({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      currentRun: {
        ...currentRun,
        runItems: [{
          type: 'tool_result',
          toolCallId: 'call:1',
          toolName: 'use_skill',
          status: 'success',
          content: [{ type: 'text', text: 'loaded' }],
          runtimeSources: [{
            sourceId: 'skill:dynamic',
            sourceKind: 'skill',
            text: 'Dynamic instructions.',
            persisted: false,
            metadata: { name: 'dynamic', skillPath: '/skills/dynamic/SKILL.md' },
          }],
        }],
      },
      selectedSkill: {
        type: 'skill',
        name: 'selected',
        skillPath: '/skills/selected/SKILL.md',
      },
      tools: [],
      model,
    });

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      const serialized = JSON.stringify(result.prepared.context.messages);
      expect(serialized).toContain('Selected instructions.');
      expect(serialized).toContain('Dynamic instructions.');
    }
  });

  it('distinguishes cancellation, owner failure, and hard Context window exhaustion', async () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(await createContext(fixture()).build({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      currentRun,
      tools: [],
      model,
      signal: aborted.signal,
    })).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });

    const failedOptions: CreateContextOptions = {
      ...fixture(),
      scopeResolver: {
        resolve: vi.fn(() => ({
          status: 'failed' as const,
          failure: { code: 'workspace_missing', message: 'missing' },
        })),
      },
    };
    expect(await createContext(failedOptions).build({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      currentRun,
      tools: [],
      model,
    })).toMatchObject({
      status: 'failed',
      failure: { code: 'instruction_load_failed', cause: { owner: 'instructions' } },
    });

    const exhausted: CreateContextOptions = {
      ...fixture(100),
      sessionHistory: {
        getActiveHistory: vi.fn(() => ({ status: 'ok' as const, history: [] })),
        saveCompactionSummary: vi.fn(),
      },
    };
    expect(await createContext(exhausted).build({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      currentRun,
      tools: [],
      model,
    })).toMatchObject({ status: 'failed', failure: { code: 'context_window_exceeded' } });
  });
});
