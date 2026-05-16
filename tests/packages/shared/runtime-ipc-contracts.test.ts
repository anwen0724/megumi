// @vitest-environment node
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  RuntimeIpcErrorSchema as BarrelRuntimeIpcErrorSchema,
  RuntimeContextSchema as BarrelRuntimeContextSchema,
  createRuntimeIpcRequestSchema as barrelCreateRuntimeIpcRequestSchema,
  createRuntimeRequestSchema as barrelCreateRuntimeRequestSchema,
} from '@megumi/shared';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { JsonObjectSchema, JsonValueSchema } from '@megumi/shared/json';
import {
  RUNTIME_IPC_ERROR_CODES,
  RuntimeIpcErrorSchema,
  isRuntimeIpcErrorCode,
  sanitizeZodIssues,
} from '@megumi/shared/ipc-errors';
import {
  BUSINESS_IPC_CHANNELS,
  BusinessIpcChannelSchema,
  RuntimeIpcRequestIdSchema,
  createRuntimeIpcRequestSchema,
  createRuntimeIpcResultSchema,
  isBusinessIpcChannel,
} from '@megumi/shared/ipc-contracts';
import {
  AgentToolDefinitionsListRequestSchema,
  AgentPlanByRunGetRequestSchema,
  AgentContextBaselineGetRequestSchema,
  AgentContextSourcesListRequestSchema,
  AgentRunStartRequestSchema,
  AgentSessionCreateRequestSchema,
  AgentSessionListRequestSchema,
  ChatCancelPayloadSchema,
  ChatCancelRequestSchema,
  ChatStartPayloadSchema,
  ChatStartRequestSchema,
  ProviderApiKeyRequestSchema,
  ProviderListDataSchema,
  ProviderListRequestSchema,
  ProviderUpdateRequestSchema,
} from '@megumi/shared/ipc-schemas';

describe('json value schemas', () => {
  it('accepts structured clone safe JSON values', () => {
    const value = {
      message: 'hello',
      count: 2,
      enabled: true,
      nested: {
        list: ['a', null, 3],
      },
    };

    const result = JsonValueSchema.safeParse(value);

    expect(result.success).toBe(true);
  });

  it('rejects non-JSON values', () => {
    expect(JsonValueSchema.safeParse(() => 'nope').success).toBe(false);
    expect(JsonValueSchema.safeParse(Symbol('nope')).success).toBe(false);
    expect(JsonObjectSchema.safeParse(['not', 'object']).success).toBe(false);
  });
});

describe('runtime ipc error schemas', () => {
  it('defines stable base error codes', () => {
    expect(RUNTIME_IPC_ERROR_CODES).toEqual([
      'ipc_invalid_request',
      'ipc_handler_failed',
      'ipc_invoke_failed',
      'config_invalid',
      'provider_disabled',
      'provider_missing_api_key',
      'provider_auth_failed',
      'provider_rate_limited',
      'provider_network_error',
      'provider_unsupported',
      'database_error',
      'filesystem_error',
      'security_denied',
      'runtime_cancelled',
      'runtime_protocol_violation',
      'runtime_unknown',
      'tool_input_invalid',
      'tool_execution_failed',
      'approval_denied',
      'workspace_untrusted',
      'workspace_path_denied',
      'artifact_write_failed',
      'memory_write_failed',
    ]);

    expect(isRuntimeIpcErrorCode('provider_disabled')).toBe(true);
    expect(isRuntimeIpcErrorCode('legacy_stage_failed')).toBe(false);
  });

  it('accepts display-safe runtime ipc errors', () => {
    const result = RuntimeIpcErrorSchema.safeParse({
      code: 'config_invalid',
      message: 'Megumi config is invalid. Fix C:\\Users\\anwen\\.megumi\\config.json and try again.',
      severity: 'error',
      retryable: false,
      source: 'config',
      details: {
        configPath: 'C:\\Users\\anwen\\.megumi\\config.json',
        issueCount: 1,
      },
      debugId: 'debug-1',
    });

    expect(result.success).toBe(true);
  });

  it('rejects stack and cause fields in renderer-facing errors', () => {
    const result = RuntimeIpcErrorSchema.safeParse({
      code: 'runtime_unknown',
      message: 'Request failed.',
      severity: 'error',
      retryable: true,
      source: 'main',
      stack: 'Error: secret stack',
      cause: {
        message: 'raw cause',
      },
    });

    expect(result.success).toBe(false);
  });

  it('sanitizes zod issues for invalid request details', () => {
    const schema = z.object({
      providerId: z.enum(['deepseek']),
      apiKey: z.string().min(1),
    });
    const result = schema.safeParse({
      providerId: 'wrong',
      apiKey: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const details = sanitizeZodIssues(result.error);

      expect(details.issueCount).toBe(2);
      expect(details.issues[0]).toEqual({
        path: 'providerId',
        code: 'invalid_enum_value',
        message: expect.any(String),
      });
      expect(JSON.stringify(details)).not.toContain('sk-');
    }
  });
});

describe('runtime ipc request and result schemas', () => {
  const payloadSchema = z.object({ providerId: z.literal('deepseek') }).strict();
  const requestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.provider.list, payloadSchema);
  const resultSchema = createRuntimeIpcResultSchema(
    z.object({
      providers: z.array(z.object({ providerId: z.string() })),
    }).strict(),
  );

  it('treats provider and chat request channels as business IPC', () => {
    expect(isBusinessIpcChannel(IPC_CHANNELS.provider.list)).toBe(true);
    expect(isBusinessIpcChannel(IPC_CHANNELS.chat.start)).toBe(true);
    expect(isBusinessIpcChannel(IPC_CHANNELS.chat.cancel)).toBe(true);
    expect(isBusinessIpcChannel(IPC_CHANNELS.window.minimize)).toBe(false);
    expect(isBusinessIpcChannel(IPC_CHANNELS.runtime.event)).toBe(false);
    expect(BusinessIpcChannelSchema.safeParse(IPC_CHANNELS.window.close).success).toBe(false);
  });

  it('validates a request for the exact channel', () => {
    const result = requestSchema.safeParse({
      requestId: 'ipc-request-1',
      payload: {
        providerId: 'deepseek',
      },
      meta: {
        channel: IPC_CHANNELS.provider.list,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects mismatched channels and invalid request ids', () => {
    expect(RuntimeIpcRequestIdSchema.safeParse('bad id with spaces').success).toBe(false);

    const result = requestSchema.safeParse({
      requestId: 'ipc-request-1',
      payload: {
        providerId: 'deepseek',
      },
      meta: {
        channel: IPC_CHANNELS.chat.start,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(result.success).toBe(false);
  });

  it('validates success and failure results', () => {
    const success = resultSchema.safeParse({
      ok: true,
      data: {
        providers: [{ providerId: 'deepseek' }],
      },
      meta: {
        requestId: 'ipc-request-1',
        channel: IPC_CHANNELS.provider.list,
        handledAt: '2026-05-12T00:00:01.000Z',
        durationMs: 12,
      },
    });

    const failure = resultSchema.safeParse({
      ok: false,
      error: {
        code: 'provider_disabled',
        message: 'Provider is disabled.',
        severity: 'warning',
        retryable: false,
        source: 'provider',
      },
      meta: {
        requestId: 'ipc-request-1',
        channel: IPC_CHANNELS.provider.list,
        handledAt: '2026-05-12T00:00:01.000Z',
      },
    });

    expect(success.success).toBe(true);
    expect(failure.success).toBe(true);
  });
});

describe('runtime ipc context adapter', () => {
  const payloadSchema = z.object({ providerId: z.literal('deepseek') }).strict();
  const requestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.provider.list, payloadSchema);
  const resultSchema = createRuntimeIpcResultSchema(
    z.object({
      providers: z.array(z.object({ providerId: z.string() })),
    }).strict(),
    IPC_CHANNELS.provider.list,
  );

  it('accepts optional runtime context on the current IPC request envelope', () => {
    const request = {
      requestId: 'ipc-provider-list-1',
      payload: {
        providerId: 'deepseek',
      },
      meta: {
        channel: IPC_CHANNELS.provider.list,
        createdAt: '2026-05-14T00:00:00.000Z',
        source: 'renderer',
      },
      context: {
        requestId: 'ipc-provider-list-1',
        traceId: 'trace-provider-1',
        operationName: 'provider.list',
        source: 'renderer',
        createdAt: '2026-05-14T00:00:00.000Z',
      },
    };

    expect(requestSchema.parse(request)).toEqual(request);
  });

  it('keeps runtime context optional during IPC migration', () => {
    const request = {
      requestId: 'ipc-provider-list-1',
      payload: {
        providerId: 'deepseek',
      },
      meta: {
        channel: IPC_CHANNELS.provider.list,
        createdAt: '2026-05-14T00:00:00.000Z',
        source: 'renderer',
      },
    };

    expect(requestSchema.parse(request)).toEqual(request);
  });

  it('accepts trace/debug metadata on IPC response meta', () => {
    const result = {
      ok: false,
      error: {
        code: 'runtime_unknown',
        message: 'Unexpected runtime error.',
        severity: 'error',
        retryable: true,
        source: 'main',
        debugId: 'debug-provider-1',
      },
      meta: {
        requestId: 'ipc-provider-list-1',
        channel: IPC_CHANNELS.provider.list,
        traceId: 'trace-provider-1',
        debugId: 'debug-provider-1',
        operationName: 'provider.list',
        handledAt: '2026-05-14T00:00:01.000Z',
        durationMs: 12,
      },
    };

    expect(resultSchema.parse(result)).toEqual(result);
  });

  it('does not turn window controls or runtime events into business IPC', () => {
    expect(BusinessIpcChannelSchema.safeParse(IPC_CHANNELS.window.minimize).success).toBe(false);
    expect(BusinessIpcChannelSchema.safeParse(IPC_CHANNELS.window.toggleMaximize).success).toBe(false);
    expect(BusinessIpcChannelSchema.safeParse(IPC_CHANNELS.window.close).success).toBe(false);
    expect(BusinessIpcChannelSchema.safeParse(IPC_CHANNELS.runtime.event).success).toBe(false);
  });
});

describe('provider and chat ipc schemas', () => {
  it('validates provider list and update requests', () => {
    const list = ProviderListRequestSchema.safeParse({
      requestId: 'ipc-provider-list-1',
      payload: {},
      meta: {
        channel: IPC_CHANNELS.provider.list,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });

    const update = ProviderUpdateRequestSchema.safeParse({
      requestId: 'ipc-provider-update-1',
      payload: {
        providerId: 'deepseek',
        enabled: true,
        displayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        defaultModelId: 'deepseek-v4-flash',
      },
      meta: {
        channel: IPC_CHANNELS.provider.update,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(list.success).toBe(true);
    expect(update.success).toBe(true);
  });

  it('validates provider public status data without plaintext secrets', () => {
    const result = ProviderListDataSchema.safeParse({
      providers: [
        {
          providerId: 'deepseek',
          displayName: 'DeepSeek',
          enabled: true,
          baseUrl: 'https://api.deepseek.com',
          defaultModelId: 'deepseek-v4-flash',
          hasSecret: true,
          credentialSource: 'secret-store',
          envOverrideActive: false,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.success ? result.data : {})).not.toContain('sk-');
  });

  it('allows api key only in the explicit provider set api key request payload', () => {
    const result = ProviderApiKeyRequestSchema.safeParse({
      requestId: 'ipc-provider-key-1',
      payload: {
        providerId: 'deepseek',
        apiKey: 'sk-test-only-fixture',
      },
      meta: {
        channel: IPC_CHANNELS.provider.setApiKey,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(result.success).toBe(true);
  });

  it('validates chat start payloads without a duplicate request id in payload', () => {
    const result = ChatStartRequestSchema.safeParse({
      requestId: 'ipc-chat-start-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'Hello Megumi',
            createdAt: '2026-05-12T00:00:00.000Z',
          },
        ],
        context: {
          workspaceLabel: 'Megumi',
          workspacePath: 'C:/all/work/study/megumi',
          composerMode: 'chat',
        },
        createdAt: '2026-05-12T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.chat.start,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(result.success).toBe(true);
  });

  it('uses a target request id for chat cancellation payloads', () => {
    const payload = ChatCancelPayloadSchema.safeParse({
      targetRequestId: 'ipc-chat-start-1',
    });

    const request = ChatCancelRequestSchema.safeParse({
      requestId: 'ipc-chat-cancel-1',
      payload: {
        targetRequestId: 'ipc-chat-start-1',
      },
      meta: {
        channel: IPC_CHANNELS.chat.cancel,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(payload.success).toBe(true);
    expect(request.success).toBe(true);
  });

  it('rejects invalid chat messages', () => {
    const result = ChatStartPayloadSchema.safeParse({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      messages: [
        {
          id: 'message-1',
          role: 'admin',
          content: 'Hello',
          createdAt: '2026-05-12T00:00:00.000Z',
        },
      ],
      createdAt: '2026-05-12T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});

describe('agent lifecycle ipc contracts', () => {
  it('validates agent lifecycle runtime ipc requests', () => {
    expect(AgentSessionCreateRequestSchema.parse({
      requestId: 'ipc-agent-session-create-1',
      payload: {
        title: 'New session',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.agent.session.create,
        source: 'renderer',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
    }).payload.title).toBe('New session');

    expect(AgentSessionListRequestSchema.parse({
      requestId: 'ipc-agent-session-list-1',
      payload: {},
      meta: {
        channel: IPC_CHANNELS.agent.session.list,
        source: 'renderer',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
    }).meta.channel).toBe('agent:session:list');

    expect(AgentRunStartRequestSchema.parse({
      requestId: 'ipc-agent-run-start-1',
      payload: {
        sessionId: 'session-1',
        goal: 'Answer',
        mode: 'chat',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.agent.run.start,
        source: 'renderer',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
    }).payload.goal).toBe('Answer');
  });

  it('accepts mode snapshots and source plan ids in agent run start payloads', () => {
    const parsed = AgentRunStartRequestSchema.parse({
      requestId: 'request:run-mode',
      payload: {
        sessionId: 'session:1',
        goal: 'Execute accepted plan',
        mode: 'execute',
        modeSnapshot: {
          preset: 'execute',
          taskIntent: 'work',
          permissionMode: 'default',
          outputExpectation: 'execution_result',
          selectionSource: 'user_selected',
        },
        sourcePlanId: 'plan:accepted',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.agent.run.start,
        createdAt: '2026-05-15T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(parsed.payload.modeSnapshot?.permissionMode).toBe('default');
    expect(parsed.payload.sourcePlanId).toBe('plan:accepted');
  });

  it('registers plan-specific IPC channels in the runtime envelope', () => {
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.agent.plan.byRunGet);
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.agent.plan.statusUpdate);
    expect(AgentPlanByRunGetRequestSchema.parse({
      requestId: 'request:plan-get',
      payload: { runId: 'run:plan' },
      meta: {
        channel: IPC_CHANNELS.agent.plan.byRunGet,
        createdAt: '2026-05-15T00:00:00.000Z',
        source: 'renderer',
      },
    }).payload.runId).toBe('run:plan');
  });
});

describe('agent context runtime IPC schemas', () => {
  it('keeps context channel in request.meta.channel instead of top-level channel', () => {
    const parsed = AgentContextBaselineGetRequestSchema.parse({
      requestId: 'ipc-context-1',
      payload: {
        runId: 'run-1',
      },
      meta: {
        channel: IPC_CHANNELS.agent.context.baselineGet,
        createdAt: '2026-05-15T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(parsed.meta.channel).toBe(IPC_CHANNELS.agent.context.baselineGet);
    expect('channel' in parsed).toBe(false);
  });

  it('rejects top-level channel on context requests', () => {
    expect(() => AgentContextSourcesListRequestSchema.parse({
      requestId: 'ipc-context-2',
      channel: IPC_CHANNELS.agent.context.sourcesList,
      payload: {
        runId: 'run-1',
      },
      meta: {
        channel: IPC_CHANNELS.agent.context.sourcesList,
        createdAt: '2026-05-15T00:00:00.000Z',
        source: 'renderer',
      },
    })).toThrow();
  });
});

describe('agent tool approval runtime IPC schemas', () => {
  it('parses agent tool IPC requests with channel in request meta only', () => {
    const request = AgentToolDefinitionsListRequestSchema.parse({
      requestId: 'ipc-1',
      payload: { runId: 'run-1' },
      meta: {
        channel: IPC_CHANNELS.agent.tool.definitionsList,
        createdAt: '2026-05-16T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(request.meta.channel).toBe(IPC_CHANNELS.agent.tool.definitionsList);
    expect('channel' in request).toBe(false);
  });
});

describe('shared barrel exports', () => {
  it('exports runtime ipc and runtime common contracts from @megumi/shared', () => {
    const error = BarrelRuntimeIpcErrorSchema.safeParse({
      code: 'runtime_unknown',
      message: 'Request failed.',
      severity: 'error',
      retryable: true,
      source: 'unknown',
    });
    const context = BarrelRuntimeContextSchema.safeParse({
      requestId: 'ipc-provider-list-1',
      traceId: 'trace-provider-1',
      operationName: 'provider.list',
      source: 'renderer',
      createdAt: '2026-05-14T00:00:00.000Z',
    });
    const runtimeRequestSchema = barrelCreateRuntimeRequestSchema(z.object({ message: z.string() }).strict());

    expect(error.success).toBe(true);
    expect(context.success).toBe(true);
    expect(typeof barrelCreateRuntimeIpcRequestSchema).toBe('function');
    expect(typeof runtimeRequestSchema.parse).toBe('function');
  });
});
