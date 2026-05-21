// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import * as messageMapper from '@megumi/ai/prompt/message-mapper';
import { buildSystemPrompt } from '@megumi/ai/prompt/system-prompt';
import { AI_PROVIDER_DEFAULTS } from '@megumi/ai/models';
import type { ToolDefinition, ToolResult, ToolUse } from '@megumi/shared/tool-contracts';

const request: ChatRuntimeRequest = {
  requestId: 'request-1',
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  createdAt: '2026-05-11T00:00:00.000Z',
  context: {
    workspaceLabel: 'Megumi Workspace',
    workspacePath: 'C:/all/work/study/megumi',
    sessionTitle: 'Provider runtime',
    permissionMode: 'plan',
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
        'Permission mode: plan',
        'Use the provided context only as lightweight orientation. Do not claim to have inspected files unless tool results are provided.',
      ].join('\n'),
    );
  });
});

describe('OpenAI-compatible message mapper', () => {
  it('prepends a context system message and maps chat roles', () => {
    expect(messageMapper.mapToOpenAICompatibleMessages(request)).toEqual([
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
    const messages = messageMapper.mapToOpenAICompatibleMessages({
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

  it('maps session messages for model step requests', () => {
    expect(messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      messages: [
        {
          messageId: 'message-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Hello',
          status: 'completed',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
      ],
      createdAt: '2026-05-17T00:00:00.000Z',
    })).toEqual([
      {
        role: 'system',
        content: expect.stringContaining('You are Megumi'),
      },
      {
        role: 'user',
        content: 'Hello',
      },
    ]);
  });

  it('adds permission mode runtime instructions to model step system prompts', () => {
    const messages = messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      messages: [
        {
          messageId: 'message-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Write the implementation plan',
          status: 'completed',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
      ],
      modeSnapshot: {
        permissionMode: 'plan',
        source: 'user',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      modeSnapshotRef: 'mode-snapshot:1',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    expect(messages[0]?.content).toContain('Permission mode: plan');
    expect(messages[0]?.content).toContain('Do not modify files or run side-effecting commands.');
    expect(messages[0]?.content).not.toContain('Task intent:');
    expect(messages[0]?.content).not.toContain('Output expectation:');
  });

  it('maps model step tool definitions to OpenAI-compatible request tools', () => {
    const readFileTool: ToolDefinition = {
      name: 'read_file',
      description: 'Read a file from the current workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
    };

    expect(messageMapper.mapModelStepToOpenAICompatibleRequest({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      messages: [],
      toolDefinitions: [readFileTool],
      createdAt: '2026-05-17T00:00:00.000Z',
    })).toMatchObject({
      model: 'gpt-5.5',
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file from the current workspace.',
            parameters: readFileTool.inputSchema,
          },
        },
      ],
      tool_choice: 'auto',
    });
  });

  it('appends previous tool results as OpenAI-compatible tool messages', () => {
    const toolResult: ToolResult = {
      toolResultId: 'tool-result-1',
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      kind: 'success',
      textContent: 'File contents',
      redactionState: 'none',
      createdAt: '2026-05-17T00:00:01.000Z',
    };

    expect(messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      messages: [],
      toolResults: [toolResult],
      createdAt: '2026-05-17T00:00:00.000Z',
    })).toContainEqual({
      role: 'tool',
      tool_call_id: 'tool-use-1',
      content: 'File contents',
    });
  });

  it('orders previous assistant tool calls before matching tool result messages', () => {
    const toolUse: ToolUse = {
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      modelStepId: 'model-step-1',
      providerToolUseId: 'provider-tool-use-1',
      toolName: 'read_file',
      input: { path: 'package.json' },
      inputPreview: {
        summary: 'read_file package.json',
        targets: [],
        redactionState: 'none',
      },
      status: 'created',
      createdAt: '2026-05-17T00:00:01.000Z',
    };
    const toolResult: ToolResult = {
      toolResultId: 'tool-result-1',
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      kind: 'success',
      textContent: 'File contents',
      redactionState: 'none',
      createdAt: '2026-05-17T00:00:02.000Z',
    };

    const messages = messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-2',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      messages: [
        {
          messageId: 'message-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Read package.json',
          status: 'completed',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
      ],
      toolUses: [toolUse],
      toolResults: [toolResult],
      createdAt: '2026-05-17T00:00:03.000Z',
    });

    expect(messages.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tool-use-1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"package.json"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tool-use-1',
        content: 'File contents',
      },
    ]);
  });

  it('serializes non-text tool result fallback content with result metadata', () => {
    const toolResult: ToolResult = {
      toolResultId: 'tool-result-1',
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      kind: 'policy_denied',
      structuredContent: {
        path: 'C:/all/work/study/megumi/.env',
      },
      denialReason: 'Reading secrets is not allowed.',
      redactionState: 'blocked',
      createdAt: '2026-05-17T00:00:01.000Z',
    };

    const messages = messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      messages: [],
      toolResults: [toolResult],
      createdAt: '2026-05-17T00:00:00.000Z',
    });
    const toolMessage = messages.find((message) => message.role === 'tool');

    expect(toolMessage?.tool_call_id).toBe('tool-use-1');
    expect(JSON.parse(toolMessage?.content ?? '')).toEqual({
      kind: 'policy_denied',
      structuredContent: {
        path: 'C:/all/work/study/megumi/.env',
      },
      denialReason: 'Reading secrets is not allowed.',
    });
  });

  it('uses permission mode snapshots without legacy task intent or output expectation prompt lines', () => {
    const messages = messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      messages: [],
      modeSnapshot: {
        permissionMode: 'plan',
        source: 'user',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    expect(messages[0]?.content).toContain('Permission mode: plan');
    expect(messages[0]?.content).not.toContain('Task intent:');
    expect(messages[0]?.content).not.toContain('Output expectation:');
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
