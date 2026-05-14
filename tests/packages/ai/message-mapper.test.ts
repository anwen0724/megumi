// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import { mapToOpenAICompatibleMessages } from '@megumi/ai/prompt/message-mapper';
import { buildSystemPrompt } from '@megumi/ai/prompt/system-prompt';
import { AI_PROVIDER_DEFAULTS } from '@megumi/ai/models';

const request: ChatRuntimeRequest = {
  requestId: 'request-1',
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  createdAt: '2026-05-11T00:00:00.000Z',
  context: {
    workspaceLabel: 'Megumi Workspace',
    workspacePath: 'C:/all/work/study/megumi',
    sessionTitle: 'Provider runtime',
    composerMode: 'agent',
  },
  messages: [
    {
      id: 'message-1',
      role: 'user',
      content: '你好',
      createdAt: '2026-05-11T00:00:00.000Z',
    },
    {
      id: 'message-2',
      role: 'assistant',
      content: '你好，我在。',
      createdAt: '2026-05-11T00:00:01.000Z',
    },
  ],
};

describe('system prompt', () => {
  it('builds minimal workspace grounding without crawling files', () => {
    expect(buildSystemPrompt(request.context)).toBe(
      [
        'You are Megumi, a warm and capable desktop AI agent companion.',
        'Current workspace: Megumi Workspace',
        'Workspace path: C:/all/work/study/megumi',
        'Current session: Provider runtime',
        'Composer mode: agent',
        'Use the provided context only as lightweight orientation. Do not claim to have inspected files unless tool results are provided.',
      ].join('\n'),
    );
  });
});

describe('OpenAI-compatible message mapper', () => {
  it('prepends a context system message and maps chat roles', () => {
    expect(mapToOpenAICompatibleMessages(request)).toEqual([
      {
        role: 'system',
        content: buildSystemPrompt(request.context),
      },
      {
        role: 'user',
        content: '你好',
      },
      {
        role: 'assistant',
        content: '你好，我在。',
      },
    ]);
  });

  it('keeps explicit system messages after the generated context prompt', () => {
    const messages = mapToOpenAICompatibleMessages({
      ...request,
      messages: [
        {
          id: 'message-system',
          role: 'system',
          content: 'Answer concisely.',
          createdAt: '2026-05-11T00:00:00.000Z',
        },
      ],
    });

    expect(messages).toEqual([
      {
        role: 'system',
        content: buildSystemPrompt(request.context),
      },
      {
        role: 'system',
        content: 'Answer concisely.',
      },
    ]);
  });

  it('exposes phase 1 provider defaults', () => {
    expect(AI_PROVIDER_DEFAULTS).toEqual({
      deepseek: {
        baseUrl: 'https://api.deepseek.com',
        defaultModelId: 'deepseek-v4-flash',
      },
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        defaultModelId: 'gpt-5.5',
      },
      anthropic: {
        defaultModelId: 'claude-sonnet-4-6',
      },
    });
  });
});
