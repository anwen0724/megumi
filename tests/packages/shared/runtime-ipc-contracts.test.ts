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
  ProjectListRequestSchema,
  ProjectListResultSchema,
  ProjectOpenRequestSchema,
  ProjectRecordSchema,
  ProjectRemoveRequestSchema,
  ProjectUseExistingRequestSchema,
  ProjectUseExistingResultSchema,
} from '@megumi/shared/ipc-schemas';
import {
  ArtifactGetRequestSchema,
  ArtifactGetResultSchema,
  ArtifactStatusUpdatePayloadSchema,
  MemoryCandidateAcceptPayloadSchema,
  MemoryCandidateListPayloadSchema,
  MemoryListDataSchema,
  MemoryRecallPreviewDataSchema,
  MemoryRecallPreviewPayloadSchema,
  MemoryRecallPreviewRequestSchema,
  MemorySettingsGetRequestSchema,
  MemorySettingsGetResultSchema,
  MemorySettingsUpdatePayloadSchema,
  PlanByRunGetRequestSchema,
  ProviderApiKeyRequestSchema,
  ProviderListDataSchema,
  ProviderListRequestSchema,
  ProviderUpdateRequestSchema,
  RecoverableRunListRequestSchema,
  RecoverableRunListResultSchema,
  RunCancelRequestSchema,
  RunContextBaselineGetRequestSchema,
  RunContextSourcesListRequestSchema,
  RunEventsListRequestSchema,
  RunListBySessionRequestSchema,
  RunResumeRequestSchema,
  RunRetryRequestSchema,
  RunStartPayloadSchema,
  WorkspaceRestoreRequestSchema,
  WorkspaceRestoreResultSchema,
  SessionCreateRequestSchema,
  SessionBranchDraftCancelRequestSchema,
  SessionBranchDraftCreateRequestSchema,
  SessionListRequestSchema,
  SessionMessageCancelPayloadSchema,
  SessionMessageCancelRequestSchema,
  SessionMessageListRequestSchema,
  SessionMessageSendPayloadSchema,
  SessionMessageSendRequestSchema,
  ToolDefinitionsListRequestSchema,
  ToolExecutionGetDataSchema,
  ToolExecutionGetRequestSchema,
  ToolExecutionGetResultSchema,
  WorkspaceFilesListRequestSchema,
  WorkspaceFilesListResultSchema,
  WorkspaceFileOpenRequestSchema,
  WorkspaceFileOpenResultSchema,
  type SessionBranchDraftCancelPayload,
  type SessionBranchDraftCreatePayload,
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
      'provider_invalid_request',
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

  it('treats provider and primary session run request channels as business IPC', () => {
    expect(isBusinessIpcChannel(IPC_CHANNELS.provider.list)).toBe(true);
    expect(isBusinessIpcChannel(IPC_CHANNELS.session.message.send)).toBe(true);
    expect(isBusinessIpcChannel(IPC_CHANNELS.session.message.cancel)).toBe(true);
    expect(isBusinessIpcChannel(IPC_CHANNELS.run.events.list)).toBe(true);
    expect(isBusinessIpcChannel(IPC_CHANNELS.session.message.send)).toBe(true);
    expect(isBusinessIpcChannel(IPC_CHANNELS.session.message.cancel)).toBe(true);
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
        channel: IPC_CHANNELS.session.message.send,
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

  it('accepts project runtime ipc requests and results', () => {
    const project = ProjectRecordSchema.parse({
      projectId: 'project:abc123',
      name: 'megumi',
      repoPath: 'C:/all/work/study/megumi',
      repoPathKey: 'c:/all/work/study/megumi',
      status: 'available',
      createdAt: '2026-05-19T00:00:00.000Z',
      lastOpenedAt: '2026-05-19T00:00:01.000Z',
    });

    expect(ProjectListRequestSchema.parse({
      requestId: 'ipc-project-list-1',
      payload: {},
      meta: {
        channel: IPC_CHANNELS.project.list,
        createdAt: '2026-05-19T00:00:00.000Z',
        source: 'renderer',
      },
    }).meta.channel).toBe(IPC_CHANNELS.project.list);

    expect(ProjectUseExistingRequestSchema.parse({
      requestId: 'ipc-project-use-existing-1',
      payload: {},
      meta: {
        channel: IPC_CHANNELS.project.useExisting,
        createdAt: '2026-05-19T00:00:00.000Z',
        source: 'renderer',
      },
    }).payload).toEqual({});

    expect(ProjectOpenRequestSchema.parse({
      requestId: 'ipc-project-open-1',
      payload: { projectId: project.projectId },
      meta: {
        channel: IPC_CHANNELS.project.open,
        createdAt: '2026-05-19T00:00:00.000Z',
        source: 'renderer',
      },
    }).payload.projectId).toBe(project.projectId);

    expect(ProjectRemoveRequestSchema.parse({
      requestId: 'ipc-project-remove-1',
      payload: { projectId: project.projectId },
      meta: {
        channel: IPC_CHANNELS.project.remove,
        createdAt: '2026-05-19T00:00:00.000Z',
        source: 'renderer',
      },
    }).payload.projectId).toBe(project.projectId);

    expect(ProjectListResultSchema.parse({
      ok: true,
      data: { projects: [project] },
      meta: {
        requestId: 'ipc-project-list-1',
        channel: IPC_CHANNELS.project.list,
        handledAt: '2026-05-19T00:00:01.000Z',
      },
    }).ok).toBe(true);

    const cancelled = ProjectUseExistingResultSchema.parse({
      ok: true,
      data: { cancelled: true },
      meta: {
        requestId: 'ipc-project-use-existing-1',
        channel: IPC_CHANNELS.project.useExisting,
        handledAt: '2026-05-19T00:00:01.000Z',
      },
    });

    expect(cancelled.ok).toBe(true);
  });

  it('accepts workspace files list runtime ipc request and result', () => {
    const request = WorkspaceFilesListRequestSchema.parse({
      requestId: 'ipc-workspace-files-list-1',
      payload: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
      },
      meta: {
        channel: IPC_CHANNELS.workspace.files.list,
        createdAt: '2026-05-18T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(request.meta.channel).toBe(IPC_CHANNELS.workspace.files.list);

    const result = WorkspaceFilesListResultSchema.parse({
      ok: true,
      data: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
        entries: [{
          name: 'apps',
          relativePath: 'apps',
          kind: 'directory',
          depth: 0,
          hidden: false,
          ignored: false,
        }],
      },
      meta: {
        requestId: 'ipc-workspace-files-list-1',
        channel: IPC_CHANNELS.workspace.files.list,
        handledAt: '2026-05-18T00:00:01.000Z',
      },
    });

    expect(result.ok).toBe(true);
  });

  it('accepts workspace file open runtime ipc request and result', () => {
    const request = WorkspaceFileOpenRequestSchema.parse({
      requestId: 'ipc-workspace-files-open-1',
      payload: {
        workspaceRoot: 'C:/all/work/study/megumi',
        filePath: 'src/app.ts',
      },
      meta: {
        channel: IPC_CHANNELS.workspace.files.open,
        createdAt: '2026-05-18T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(request.meta.channel).toBe(IPC_CHANNELS.workspace.files.open);

    const result = WorkspaceFileOpenResultSchema.parse({
      ok: true,
      data: {
        workspaceRoot: 'C:/all/work/study/megumi',
        filePath: 'src/app.ts',
        opened: true,
      },
      meta: {
        requestId: 'ipc-workspace-files-open-1',
        channel: IPC_CHANNELS.workspace.files.open,
        handledAt: '2026-05-18T00:00:01.000Z',
      },
    });

    expect(result.ok).toBe(true);
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
    const result = SessionMessageSendRequestSchema.safeParse({
      requestId: 'ipc-chat-start-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        message: {
          id: 'message-1',
          content: 'Hello Megumi',
          createdAt: '2026-05-12T00:00:00.000Z',
        },
        context: {
          workspaceLabel: 'Megumi',
          workspacePath: 'C:/all/work/study/megumi',
          permissionMode: 'default',
        },
        createdAt: '2026-05-12T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.session.message.send,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts permissionMode in session message runtime context', () => {
    const parsed = SessionMessageSendRequestSchema.parse({
      requestId: 'ipc-session-message-send-1',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        message: {
          id: 'message-1',
          content: 'Plan a change',
          createdAt: '2026-05-20T00:00:00.000Z',
        },
        context: {
          workspaceId: 'project-1',
          workspacePath: 'C:/all/work/study/megumi',
          sessionTitle: 'Plan a change',
          permissionMode: 'plan',
        },
        createdAt: '2026-05-20T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.session.message.send,
        source: 'renderer',
        createdAt: '2026-05-20T00:00:00.000Z',
      },
      context: {
        requestId: 'ipc-session-message-send-1',
        traceId: 'trace-1',
        operationName: 'session.message.send',
        source: 'renderer',
        createdAt: '2026-05-20T00:00:00.000Z',
      },
    });

    expect(parsed.payload.context?.permissionMode).toBe('plan');
  });

  it('accepts code review intent metadata on session message runtime context', () => {
    const parsed = SessionMessageSendRequestSchema.parse({
      requestId: 'request:intent-review',
      payload: {
        sessionId: 'session:1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        message: {
          id: 'client-message:1',
          content: '/review 当前改动',
          createdAt: '2026-06-08T00:00:00.000Z',
        },
        context: {
          permissionMode: 'plan',
          permissionSource: 'intent_default',
          intent: {
            intentName: 'code_review',
            source: 'core_command',
            commandName: 'review',
            argsText: '当前改动',
          },
        },
        createdAt: '2026-06-08T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.session.message.send,
        createdAt: '2026-06-08T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(parsed.payload.context?.intent).toEqual({
      intentName: 'code_review',
      source: 'core_command',
      commandName: 'review',
      argsText: '当前改动',
    });
    expect(parsed.payload.context?.permissionSource).toBe('intent_default');
  });

  it('rejects legacy workflow metadata on session message runtime context', () => {
    expect(() => SessionMessageSendRequestSchema.parse({
      requestId: 'request:workflow-review',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        message: {
          id: 'client-message:1',
          content: '/review 当前改动',
          createdAt: '2026-06-11T00:00:00.000Z',
        },
        context: {
          permissionMode: 'plan',
          permissionSource: 'intent_default',
          workflow: {
            intent: 'code_review',
            source: 'core_command',
            commandName: 'review',
            argsText: '当前改动',
          },
        },
        createdAt: '2026-06-11T00:00:00.000Z',
      },
    })).toThrow();
  });

  it('rejects mismatched code review workflow metadata in session message runtime context', () => {
    expect(() => SessionMessageSendRequestSchema.parse({
      requestId: 'request:workflow-review',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        message: {
          id: 'client-message:1',
          content: '/review 当前改动',
          createdAt: '2026-06-08T00:00:00.000Z',
        },
        context: {
          permissionMode: 'plan',
          workflow: {
            intent: 'code_review',
            source: 'builtin_command',
            commandName: 'reviewx',
            argsText: '当前改动',
          },
        },
        createdAt: '2026-06-08T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.session.message.send,
        createdAt: '2026-06-08T00:00:00.000Z',
        source: 'renderer',
      },
    })).toThrow();
  });

  it('rejects mismatched code review intent metadata in session message runtime context', () => {
    expect(() => SessionMessageSendRequestSchema.parse({
      requestId: 'request:intent-review',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        message: {
          id: 'client-message:1',
          content: '/review 当前改动',
          createdAt: '2026-06-08T00:00:00.000Z',
        },
        context: {
          permissionMode: 'plan',
          intent: {
            intentName: 'code_review',
            source: 'core_command',
            commandName: 'reviewx',
            argsText: '当前改动',
          },
        },
        createdAt: '2026-06-08T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.session.message.send,
        createdAt: '2026-06-08T00:00:00.000Z',
        source: 'renderer',
      },
    })).toThrow();
  });

  it('rejects legacy composerMode in session message runtime context', () => {
    expect(() => SessionMessageSendPayloadSchema.parse({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      message: {
        id: 'message-1',
        content: 'Hello',
        createdAt: '2026-05-20T00:00:00.000Z',
      },
      context: {
        composerMode: 'execute',
      },
      createdAt: '2026-05-20T00:00:00.000Z',
    })).toThrow();
  });

  it('uses a target request id for chat cancellation payloads', () => {
    const payload = SessionMessageCancelPayloadSchema.safeParse({
      targetRequestId: 'ipc-chat-start-1',
    });

    const request = SessionMessageCancelRequestSchema.safeParse({
      requestId: 'ipc-chat-cancel-1',
      payload: {
        targetRequestId: 'ipc-chat-start-1',
      },
      meta: {
        channel: IPC_CHANNELS.session.message.cancel,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(payload.success).toBe(true);
    expect(request.success).toBe(true);
  });

  it('rejects invalid chat messages', () => {
    const result = SessionMessageSendPayloadSchema.safeParse({
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

describe('session run ipc contracts', () => {
  it('validates session runtime ipc requests', () => {
    expect(SessionCreateRequestSchema.parse({
      requestId: 'ipc-agent-session-create-1',
      payload: {
        title: 'New session',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.session.create,
        source: 'renderer',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
    }).payload.title).toBe('New session');

    expect(SessionListRequestSchema.parse({
      requestId: 'ipc-agent-session-list-1',
      payload: {},
      meta: {
        channel: IPC_CHANNELS.session.list,
        source: 'renderer',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
    }).meta.channel).toBe('session:list');

    expect(SessionMessageListRequestSchema.parse({
      requestId: 'ipc-session-message-list-1',
      payload: { sessionId: 'session-1' },
      meta: {
        channel: IPC_CHANNELS.session.message.list,
        source: 'renderer',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
    }).payload.sessionId).toBe('session-1');
  });

  it('registers plan-specific IPC channels in the runtime envelope', () => {
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.plan.byRunGet);
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.plan.statusUpdate);
    expect(PlanByRunGetRequestSchema.parse({
      requestId: 'request:plan-get',
      payload: { runId: 'run:plan' },
      meta: {
        channel: IPC_CHANNELS.plan.byRunGet,
        createdAt: '2026-05-15T00:00:00.000Z',
        source: 'renderer',
      },
    }).payload.runId).toBe('run:plan');
  });

  it('parses run start payloads with canonical permission mode state', () => {
    const payload = RunStartPayloadSchema.parse({
      sessionId: 'session-1',
      goal: 'Write a plan',
      mode: 'plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'user',
      },
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(payload.permissionModeState).toEqual({
      permissionMode: 'plan',
      source: 'user',
    });
    expect(payload).not.toHaveProperty('modeSnapshot');
  });

  it('rejects legacy modeSnapshot run start input', () => {
    expect(() => RunStartPayloadSchema.parse({
      sessionId: 'session:1',
      goal: 'Plan task',
      mode: 'plan',
      modeSnapshot: {
        permissionMode: 'plan',
        source: 'intent_default',
      },
      createdAt: '2026-06-11T00:00:00.000Z',
    })).toThrow();
  });
});

describe('agent context runtime IPC schemas', () => {
  it('keeps channel in request.meta.channel for session message send', () => {
    const parsed = SessionMessageSendRequestSchema.parse({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        message: {
          id: 'message-1',
          content: 'Hello Megumi',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
        context: {
          workspacePath: 'C:/all/work/study/megumi',
          permissionMode: 'default',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.session.message.send,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(parsed.meta.channel).toBe(IPC_CHANNELS.session.message.send);
    expect('channel' in parsed).toBe(false);
  });

  it('parses primary session run ipc request schemas', () => {
    expect(SessionCreateRequestSchema.parse({
      requestId: 'ipc-session-create-1',
      payload: {
        title: 'New session',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.session.create,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).meta.channel).toBe(IPC_CHANNELS.session.create);

    expect(SessionListRequestSchema.parse({
      requestId: 'ipc-session-list-1',
      payload: {},
      meta: {
        channel: IPC_CHANNELS.session.list,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).meta.channel).toBe(IPC_CHANNELS.session.list);

    expect(SessionMessageCancelRequestSchema.parse({
      requestId: 'ipc-session-message-cancel-1',
      payload: { targetRequestId: 'ipc-session-message-send-1' },
      meta: {
        channel: IPC_CHANNELS.session.message.cancel,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).payload.targetRequestId).toBe('ipc-session-message-send-1');

    expect(RunListBySessionRequestSchema.parse({
      requestId: 'ipc-run-list-by-session-1',
      payload: { sessionId: 'session-1' },
      meta: {
        channel: IPC_CHANNELS.run.listBySession,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).payload.sessionId).toBe('session-1');

    expect(RunEventsListRequestSchema.parse({
      requestId: 'ipc-run-events-list-1',
      payload: { runId: 'run-1' },
      meta: {
        channel: IPC_CHANNELS.run.events.list,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).meta.channel).toBe(IPC_CHANNELS.run.events.list);
  });

  it('parses session branch draft ipc contracts', () => {
    const createPayload = {
      sessionId: 'session-1',
      messageId: 'message-1',
      intent: 'branch',
      createdAt: '2026-06-01T10:00:00.000Z',
    } satisfies SessionBranchDraftCreatePayload;
    const createRequest = SessionBranchDraftCreateRequestSchema.parse({
      requestId: 'request_branch_1',
      payload: createPayload,
      meta: {
        channel: IPC_CHANNELS.session.branchDraft.create,
        createdAt: '2026-06-01T10:00:00.000Z',
        source: 'renderer',
      },
    });
    expect(createRequest.payload.intent).toBe('branch');

    const cancelPayload = {
      sessionId: 'session-1',
      branchMarkerId: 'branch-marker-1',
      createdAt: '2026-06-01T10:00:01.000Z',
    } satisfies SessionBranchDraftCancelPayload;
    const cancelRequest = SessionBranchDraftCancelRequestSchema.parse({
      requestId: 'request_branch_cancel_1',
      payload: cancelPayload,
      meta: {
        channel: IPC_CHANNELS.session.branchDraft.cancel,
        createdAt: '2026-06-01T10:00:01.000Z',
        source: 'renderer',
      },
    });
    expect(cancelRequest.meta.channel).toBe(IPC_CHANNELS.session.branchDraft.cancel);
  });

  it('parses primary run context, plan, tool, recovery, artifact, and memory request schemas', () => {
    expect(RunContextBaselineGetRequestSchema.parse({
      requestId: 'ipc-run-context-baseline-get-1',
      payload: { runId: 'run-1' },
      meta: {
        channel: IPC_CHANNELS.runContext.baselineGet,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).meta.channel).toBe(IPC_CHANNELS.runContext.baselineGet);

    expect(RunContextSourcesListRequestSchema.parse({
      requestId: 'ipc-run-context-sources-list-1',
      payload: { runId: 'run-1' },
      meta: {
        channel: IPC_CHANNELS.runContext.sourcesList,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).meta.channel).toBe(IPC_CHANNELS.runContext.sourcesList);

    expect(PlanByRunGetRequestSchema.parse({
      requestId: 'ipc-plan-by-run-get-1',
      payload: { runId: 'run-1' },
      meta: {
        channel: IPC_CHANNELS.plan.byRunGet,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).payload.runId).toBe('run-1');

    expect(ToolDefinitionsListRequestSchema.parse({
      requestId: 'ipc-tool-definitions-list-1',
      payload: { runId: 'run-1' },
      meta: {
        channel: IPC_CHANNELS.tool.definitionsList,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).meta.channel).toBe(IPC_CHANNELS.tool.definitionsList);

    expect(ToolExecutionGetRequestSchema.parse({
      requestId: 'ipc-tool-execution-get-1',
      payload: { toolExecutionId: 'tool-execution-1' },
      meta: {
        channel: IPC_CHANNELS.tool.executionGet,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).meta.channel).toBe(IPC_CHANNELS.tool.executionGet);

    expect(RunResumeRequestSchema.parse({
      requestId: 'ipc-recovery-resume-1',
      payload: {
        runId: 'run-1',
        requestedBy: 'user',
        reason: 'manual_resume',
        resumeMode: 'from_checkpoint',
      },
      meta: {
        channel: IPC_CHANNELS.recovery.resume,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).payload.resumeMode).toBe('from_checkpoint');

    expect(ArtifactGetRequestSchema.parse({
      requestId: 'ipc-artifact-get-1',
      payload: { artifactId: 'artifact-1' },
      meta: {
        channel: IPC_CHANNELS.artifacts.get,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).payload.artifactId).toBe('artifact-1');

    expect(MemorySettingsGetRequestSchema.parse({
      requestId: 'ipc-memory-settings-get-1',
      payload: { workspaceId: 'workspace-1' },
      meta: {
        channel: IPC_CHANNELS.memory.settingsGet,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    }).payload.workspaceId).toBe('workspace-1');
  });

  it('keeps context channel in request.meta.channel instead of top-level channel', () => {
    const parsed = RunContextBaselineGetRequestSchema.parse({
      requestId: 'ipc-context-1',
      payload: {
        runId: 'run-1',
      },
      meta: {
        channel: IPC_CHANNELS.runContext.baselineGet,
        createdAt: '2026-05-15T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(parsed.meta.channel).toBe(IPC_CHANNELS.runContext.baselineGet);
    expect('channel' in parsed).toBe(false);
  });

  it('rejects top-level channel on context requests', () => {
    expect(() => RunContextSourcesListRequestSchema.parse({
      requestId: 'ipc-context-2',
      channel: IPC_CHANNELS.runContext.sourcesList,
      payload: {
        runId: 'run-1',
      },
      meta: {
        channel: IPC_CHANNELS.runContext.sourcesList,
        createdAt: '2026-05-15T00:00:00.000Z',
        source: 'renderer',
      },
    })).toThrow();
  });
});

describe('agent tool approval runtime IPC schemas', () => {
  it('parses agent tool IPC requests with channel in request meta only', () => {
    const request = ToolDefinitionsListRequestSchema.parse({
      requestId: 'ipc-1',
      payload: { runId: 'run-1' },
      meta: {
        channel: IPC_CHANNELS.tool.definitionsList,
        createdAt: '2026-05-16T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(request.meta.channel).toBe(IPC_CHANNELS.tool.definitionsList);
    expect('channel' in request).toBe(false);
  });

  it('parses tool execution get IPC data and rejects old tool call data', () => {
    const toolExecution = {
      toolExecutionId: 'tool-execution-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'read_file',
      input: { path: 'README.md' },
      inputPreview: {
        summary: 'Read README.md',
        targets: [{ kind: 'file', label: 'README.md', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      status: 'pending_approval',
      requestedAt: '2026-05-16T00:00:00.000Z',
    };

    expect(ToolExecutionGetDataSchema.parse({ toolExecution }).toolExecution?.toolExecutionId).toBe('tool-execution-1');
    expect(ToolExecutionGetResultSchema.parse({
      ok: true,
      data: { toolExecution },
      meta: {
        requestId: 'ipc-tool-execution-get-1',
        channel: IPC_CHANNELS.tool.executionGet,
        handledAt: '2026-05-16T00:00:01.000Z',
      },
    }).ok).toBe(true);

    expect(ToolExecutionGetDataSchema.safeParse({
      toolCall: {
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        modelStepId: 'model-step-1',
        providerToolCallId: 'provider-tool-call-1',
        toolName: 'read_file',
        input: { path: 'README.md' },
        inputPreview: {
          summary: 'Read README.md',
          targets: [{ kind: 'file', label: 'README.md', sensitivity: 'normal' }],
          redactionState: 'none',
        },
        status: 'created',
        createdAt: '2026-05-16T00:00:00.000Z',
      },
    }).success).toBe(false);
  });
});

describe('agent recovery runtime IPC schemas', () => {
  it('parses agent recovery runtime ipc requests with meta.channel', () => {
    const listRequest = RecoverableRunListRequestSchema.parse({
      requestId: 'request_123',
      payload: {},
      meta: {
        channel: IPC_CHANNELS.recovery.recoverableRunsList,
        createdAt: '2026-05-16T10:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(listRequest.meta.channel).toBe('recovery:recoverable-runs:list');
    expect(isBusinessIpcChannel(listRequest.meta.channel)).toBe(true);

    const resumeRequest = RunResumeRequestSchema.parse({
      requestId: 'request_124',
      payload: {
        runId: 'run_123',
        checkpointId: 'checkpoint_123',
        requestedBy: 'user',
        reason: 'manual_resume',
        resumeMode: 'from_checkpoint',
      },
      meta: {
        channel: IPC_CHANNELS.recovery.resume,
        createdAt: '2026-05-16T10:00:01.000Z',
        source: 'renderer',
      },
    });

    const cancelRequest = RunCancelRequestSchema.parse({
      requestId: 'request_125',
      payload: {
        runId: 'run_123',
        requestedBy: 'user',
        reason: 'user_requested',
        scope: 'run',
      },
      meta: {
        channel: IPC_CHANNELS.recovery.cancel,
        createdAt: '2026-05-16T10:00:02.000Z',
        source: 'renderer',
      },
    });

    const retryRequest = RunRetryRequestSchema.parse({
      requestId: 'request_126',
      payload: {
        runId: 'run_123',
        requestedBy: 'runtime',
        retryKind: 'retry_run_from_checkpoint',
        reason: 'runtime_error',
      },
      meta: {
        channel: IPC_CHANNELS.recovery.retry,
        createdAt: '2026-05-16T10:00:03.000Z',
        source: 'renderer',
      },
    });

    expect(resumeRequest.payload.resumeMode).toBe('from_checkpoint');
    expect(cancelRequest.payload.scope).toBe('run');
    expect(retryRequest.payload.retryKind).toBe('retry_run_from_checkpoint');
  });

  it('parses recoverable run list results with workspace summaries but without snapshot content', () => {
    const result = RecoverableRunListResultSchema.parse({
      ok: true,
      data: {
        runs: [{
          runId: 'run-1',
          sessionId: 'session-1',
          status: 'failed',
          reason: 'failed',
          latestCheckpointId: 'checkpoint-1',
          workspaceChangeSummaries: [{
            changeSetId: 'workspace-change-set-1',
            sessionId: 'session-1',
            runId: 'run-1',
            changedFileCount: 2,
            restorableCount: 2,
            restoredCount: 0,
            conflictCount: 0,
            failedCount: 0,
            hasRestorableChanges: true,
            updatedAt: '2026-06-05T10:00:00.000Z',
          }],
        }],
      },
      meta: {
        requestId: 'request_recovery_list',
        channel: IPC_CHANNELS.recovery.recoverableRunsList,
        handledAt: '2026-06-05T10:00:01.000Z',
      },
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('contentText');
    expect(JSON.stringify(result)).not.toContain('beforeContent');
    expect(JSON.stringify(result)).not.toContain('afterContent');
  });

  it('parses workspace restore IPC request and result without snapshot content', () => {
    const request = WorkspaceRestoreRequestSchema.parse({
      requestId: 'request_workspace_restore',
      payload: {
        changeSetId: 'change-set-1',
        requestedBy: 'user',
        metadata: { source: 'recoverable-run-list' },
      },
      meta: {
        channel: IPC_CHANNELS.recovery.workspaceRestore,
        createdAt: '2026-06-05T10:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(request.meta.channel).toBe('recovery:workspace-restore');
    expect(isBusinessIpcChannel(request.meta.channel)).toBe(true);

    const result = WorkspaceRestoreResultSchema.parse({
      ok: true,
      data: {
        request: {
          restoreRequestId: 'workspace-restore-request-1',
          changeSetId: 'change-set-1',
          sessionId: 'session-1',
          runId: 'run-1',
          requestedBy: 'user',
          status: 'completed',
          requestedAt: '2026-06-05T10:00:00.000Z',
          completedAt: '2026-06-05T10:00:01.000Z',
        },
        result: {
          restoreResultId: 'workspace-restore-result-1',
          restoreRequestId: 'workspace-restore-request-1',
          changeSetId: 'change-set-1',
          sessionId: 'session-1',
          runId: 'run-1',
          status: 'partial',
          restoredAt: '2026-06-05T10:00:01.000Z',
          metadata: {
            changedFileCount: 2,
            restoredCount: 1,
            conflictCount: 1,
            failedCount: 0,
            noopCount: 0,
          },
        },
        fileResults: [{
          restoreFileResultId: 'workspace-restore-file-result-1',
          restoreResultId: 'workspace-restore-result-1',
          changedFileId: 'changed-file-1',
          projectPath: 'src/app.ts',
          status: 'restored',
          restoredAt: '2026-06-05T10:00:01.000Z',
        }],
        summary: {
          changeSetId: 'change-set-1',
          sessionId: 'session-1',
          runId: 'run-1',
          changedFileCount: 2,
          restorableCount: 0,
          restoredCount: 1,
          conflictCount: 1,
          failedCount: 0,
          hasRestorableChanges: false,
          updatedAt: '2026-06-05T10:00:01.000Z',
        },
      },
      meta: {
        requestId: 'request_workspace_restore',
        channel: IPC_CHANNELS.recovery.workspaceRestore,
        handledAt: '2026-06-05T10:00:02.000Z',
      },
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('before secret');
    expect(JSON.stringify(result)).not.toContain('after secret');
    expect(JSON.stringify(result)).not.toContain('contentText');
  });

  it('rejects extra fields in recovery IPC payloads', () => {
    expect(RecoverableRunListRequestSchema.safeParse({
      requestId: 'request_recovery_list',
      payload: { rawFullPrompt: 'secret prompt' },
      meta: {
        channel: IPC_CHANNELS.recovery.recoverableRunsList,
        createdAt: '2026-05-16T10:00:00.000Z',
        source: 'renderer',
      },
    }).success).toBe(false);

    expect(RunResumeRequestSchema.safeParse({
      requestId: 'request_resume',
      payload: {
        runId: 'run_123',
        requestedBy: 'user',
        reason: 'manual_resume',
        resumeMode: 'from_checkpoint',
        rawStack: 'secret stack',
      },
      meta: {
        channel: IPC_CHANNELS.recovery.resume,
        createdAt: '2026-05-16T10:00:01.000Z',
        source: 'renderer',
      },
    }).success).toBe(false);

    expect(RunRetryRequestSchema.safeParse({
      requestId: 'request_retry',
      payload: {
        runId: 'run_123',
        requestedBy: 'runtime',
        retryKind: 'retry_step',
        reason: 'failed',
        rawProviderBody: 'secret body',
      },
      meta: {
        channel: IPC_CHANNELS.recovery.retry,
        createdAt: '2026-05-16T10:00:02.000Z',
        source: 'renderer',
      },
    }).success).toBe(false);
  });
});

describe('agent artifact IPC contracts', () => {
  it('registers artifact IPC channels as business runtime IPC channels', () => {
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.artifacts.listByRun);
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.artifacts.listBySession);
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.artifacts.get);
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.artifacts.versionGet);
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.artifacts.versionCreate);
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.artifacts.statusUpdate);
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.artifacts.reference);
    expect(isBusinessIpcChannel(IPC_CHANNELS.artifacts.get)).toBe(true);
  });

  it('parses artifact IPC requests with channel only in request.meta.channel', () => {
    const request = ArtifactGetRequestSchema.parse({
      requestId: 'ipc:artifact:get',
      payload: { artifactId: 'artifact:1' },
      meta: {
        channel: IPC_CHANNELS.artifacts.get,
        createdAt: '2026-05-16T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(request.meta.channel).toBe(IPC_CHANNELS.artifacts.get);
    expect(request).not.toHaveProperty('channel');
  });

  it('parses artifact result data using strict schemas', () => {
    const result = ArtifactGetResultSchema.parse({
      ok: true,
      data: {
        artifact: {
          artifactId: 'artifact:1',
          kind: 'report',
          title: 'Report',
          status: 'active',
          producingRunId: 'run:1',
          currentVersionId: 'artifact-version:1',
          createdAt: '2026-05-16T00:00:00.000Z',
          updatedAt: '2026-05-16T00:00:00.000Z',
        },
        currentVersion: {
          artifactVersionId: 'artifact-version:1',
          artifactId: 'artifact:1',
          versionNumber: 1,
          contentType: 'markdown',
          contentFormat: 'text/markdown',
          contentRef: {
            storage: 'inline',
            inlineText: '# Report',
            mimeType: 'text/markdown',
            sizeBytes: 8,
            sha256: 'd'.repeat(64),
            textPreview: '# Report',
            redactionState: 'safe',
            createdAt: '2026-05-16T00:00:00.000Z',
          },
          textPreview: '# Report',
          createdByRunId: 'run:1',
          createdAt: '2026-05-16T00:00:00.000Z',
        },
        sourceRefs: [],
        relations: [],
      },
      meta: {
        requestId: 'ipc:artifact:get',
        channel: IPC_CHANNELS.artifacts.get,
        handledAt: '2026-05-16T00:00:01.000Z',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.artifact?.artifactId).toBe('artifact:1');
    }
  });

  it('rejects unknown artifact IPC fields', () => {
    expect(() => ArtifactStatusUpdatePayloadSchema.parse({
      artifactId: 'artifact:1',
      status: 'active',
      updatedAt: '2026-05-16T00:00:00.000Z',
      accepted: true,
    })).toThrow();
  });
});

describe('agent memory ipc payload and data schemas', () => {
  it('parses strict memory payload schemas before channels are wired', () => {
    expect(
      MemorySettingsUpdatePayloadSchema.parse({
        workspaceId: 'workspace:1',
        autoCaptureEnabled: false,
        defaultCandidateReviewMode: 'manual',
        updatedAt: '2026-05-16T00:00:00.000Z',
      }).defaultCandidateReviewMode,
    ).toBe('manual');

    expect(
      MemoryCandidateListPayloadSchema.parse({
        workspaceId: 'workspace:1',
        status: 'proposed',
      }).status,
    ).toBe('proposed');

    expect(() =>
      MemoryCandidateAcceptPayloadSchema.parse({
        candidateId: 'memory-candidate:1',
        reviewedAt: '2026-05-16T00:00:00.000Z',
        channel: 'memory:candidate:accept',
      }),
    ).toThrow();
  });

  it('parses memory list and recall preview data without raw source content', () => {
    const memoryData = MemoryListDataSchema.parse({
      memories: [],
    });
    const recallPayload = MemoryRecallPreviewPayloadSchema.parse({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      query: 'workflow',
      scopes: ['workspace'],
      kinds: ['workflow'],
      limit: 3,
      budget: 500,
      createdAt: '2026-05-16T00:00:00.000Z',
    });
    const recallData = MemoryRecallPreviewDataSchema.parse({
      request: {
        recallRequestId: 'memory-recall:1',
        sessionId: recallPayload.sessionId,
        workspaceId: recallPayload.workspaceId,
        query: recallPayload.query,
        scopes: recallPayload.scopes,
        kinds: recallPayload.kinds,
        limit: recallPayload.limit,
        budget: recallPayload.budget,
        createdAt: recallPayload.createdAt,
      },
      results: [],
    });

    expect(memoryData.memories).toEqual([]);
    expect(JSON.stringify(recallData)).not.toContain('raw full prompt');
  });
});

describe('agent memory runtime ipc channels', () => {
  it('registers memory channels as business IPC channels', () => {
    expect(IPC_CHANNELS.memory.settingsGet).toBe('memory:settings:get');
    expect(IPC_CHANNELS.memory.recallPreview).toBe('memory:recall-preview');
    expect(BUSINESS_IPC_CHANNELS).toContain(IPC_CHANNELS.memory.memoryList);
    expect(isBusinessIpcChannel('memory:memory:list')).toBe(true);
  });

  it('keeps channel in request meta and rejects top-level channel', () => {
    const request = MemorySettingsGetRequestSchema.parse({
      requestId: 'request:memory:settings',
      payload: { workspaceId: 'workspace:1' },
      meta: {
        channel: IPC_CHANNELS.memory.settingsGet,
        createdAt: '2026-05-16T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(request.meta.channel).toBe(IPC_CHANNELS.memory.settingsGet);
    expect(() =>
      MemoryRecallPreviewRequestSchema.parse({
        requestId: 'request:memory:recall',
        channel: IPC_CHANNELS.memory.recallPreview,
        payload: {
          sessionId: 'session:1',
          scopes: ['workspace'],
          limit: 3,
          createdAt: '2026-05-16T00:00:00.000Z',
        },
        meta: {
          channel: IPC_CHANNELS.memory.recallPreview,
          createdAt: '2026-05-16T00:00:00.000Z',
          source: 'renderer',
        },
      }),
    ).toThrow();
  });

  it('parses memory results with strict runtime ipc metadata', () => {
    const result = MemorySettingsGetResultSchema.parse({
      ok: true,
      data: {
        settings: {
          workspaceId: 'workspace:1',
          autoCaptureEnabled: true,
          defaultCandidateReviewMode: 'manual',
          updatedAt: '2026-05-16T00:00:00.000Z',
        },
      },
      meta: {
        requestId: 'request:memory:settings',
        channel: IPC_CHANNELS.memory.settingsGet,
        handledAt: '2026-05-16T00:00:01.000Z',
        operationName: 'memory.settings.get',
      },
    });

    expect(result.ok).toBe(true);
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
