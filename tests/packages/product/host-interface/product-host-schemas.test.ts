import { describe, expect, it } from 'vitest';
import {
  ApprovalResolvePayloadSchema,
  ApprovalResolveResultSchema,
  CancelUserInputPayloadSchema,
  CreateSessionResultSchema,
  ListSessionsResultSchema,
  SendUserInputPayloadSchema,
  ListSkillsUiResponseSchema,
  ProviderListUiResultSchema,
  SessionBranchDraftCancelPayloadSchema,
  SessionBranchDraftCreatePayloadSchema,
  SettingsCompleteSetupPayloadSchema,
  SettingsUpdatePayloadSchema,
  SessionMessageSendPayloadSchema,
  SkillDisablePayloadSchema,
  SkillGetPayloadSchema,
  WorkspaceFilesListPayloadSchema,
  WorkspaceListProjectsUiResultSchema,
} from '@megumi/product/host';

describe('Product Host runtime schemas', () => {
  it('accepts canonical Host requests and rejects renderer-derived workspace facts', () => {
    expect(SessionMessageSendPayloadSchema.safeParse({
      projectId: 'workspace:1',
      text: 'hello',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    }).success).toBe(true);
    expect(SessionMessageSendPayloadSchema.safeParse({
      projectId: 'workspace:1',
      projectPath: 'C:/untrusted',
      text: 'hello',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    }).success).toBe(false);
    expect(SessionMessageSendPayloadSchema.safeParse({
      projectId: 'workspace:1',
      recommendationId: 'recommendation:1',
      text: '聊聊这个实现',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    }).success).toBe(true);
    expect(SessionMessageSendPayloadSchema.safeParse({
      sessionId: 'session:1',
      projectId: 'workspace:1',
      recommendationId: 'recommendation:1',
      text: '不能把推荐注入已有会话',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    }).success).toBe(false);
    expect(SessionMessageSendPayloadSchema.safeParse({
      projectId: 'workspace:1',
      recommendationId: 'recommendation:1',
      recommendation: { title: 'Renderer 伪造的快照' },
      text: 'hello',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    }).success).toBe(false);
  });

  it('owns Workspace, Skill, and Approval request validation', () => {
    expect(WorkspaceFilesListPayloadSchema.parse({ projectId: 'workspace:1', directoryPath: '' })).toBeDefined();
    expect(SkillGetPayloadSchema.parse({ skillPath: 'C:/skills/review/SKILL.md' })).toBeDefined();
    expect(SkillDisablePayloadSchema.safeParse({
      skillPath: 'C:/skills/writing-plans/SKILL.md',
      reason: 'not used by owner',
    }).success).toBe(false);
    expect(ApprovalResolvePayloadSchema.safeParse({ approvalRequestId: 'a', decision: 'maybe' }).success).toBe(false);
  });

  it('validates every legal serializable Chat result branch', () => {
    expect(CreateSessionResultSchema.safeParse({
      status: 'failed',
      failure: { code: 'session_failed', message: 'failed' },
    }).success).toBe(true);
    expect(ListSessionsResultSchema.safeParse({ status: 'ok', sessions: [] }).success).toBe(true);
    expect(ListSessionsResultSchema.safeParse({ sessions: [] }).success).toBe(false);
    expect(SendUserInputPayloadSchema.safeParse({
      type: 'completed', requestId: 'request:1', message: 'done',
    }).success).toBe(true);
    expect(SendUserInputPayloadSchema.safeParse({
      type: 'error', requestId: 'request:1', message: 'failed', events: [],
    }).success).toBe(false);
    expect(SendUserInputPayloadSchema.safeParse({
      type: 'host_interaction_request',
      requestId: 'request:1',
      request: { kind: 'context_compaction', callback: () => undefined },
    }).success).toBe(false);
  });

  it('validates structured Chat cancel results', () => {
    expect(CancelUserInputPayloadSchema.safeParse({ cancelled: false }).success).toBe(false);
    expect(CancelUserInputPayloadSchema.safeParse({
      status: 'cancellation_requested',
      run: {
        executionId: 'run:1',
        sessionId: 'session:1',
        status: 'cancelling',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
    }).success).toBe(true);
    expect(CancelUserInputPayloadSchema.safeParse({ status: 'not_found', executionId: 'run:1' }).success).toBe(true);
    expect(CancelUserInputPayloadSchema.safeParse({
      status: 'not_cancellable',
      reason: 'already_terminal',
      run: {
        executionId: 'run:1',
        sessionId: 'session:1',
        status: 'completed',
        createdAt: '2026-07-10T00:00:00.000Z',
        completedAt: '2026-07-10T00:01:00.000Z',
      },
    }).success).toBe(true);
    expect(CancelUserInputPayloadSchema.safeParse({
      status: 'failed',
      failure: { code: 'cancel_failed', message: 'cannot cancel', retryable: true },
    }).success).toBe(true);
  });

  it('rejects renderer-provided branch draft canonical fields and rerun mode', () => {
    expect(SessionBranchDraftCreatePayloadSchema.safeParse({
      sessionId: 'session:1',
      messageId: 'assistant-message:1',
    }).success).toBe(true);
    expect(SessionBranchDraftCreatePayloadSchema.safeParse({
      sessionId: 'session:1',
      messageId: 'assistant-message:1',
      intent: 'branch',
    }).success).toBe(false);
    expect(SessionBranchDraftCreatePayloadSchema.safeParse({
      sessionId: 'session:1',
      messageId: 'assistant-message:1',
      branchMode: 'branch',
    }).success).toBe(false);
    expect(SessionBranchDraftCreatePayloadSchema.safeParse({
      sessionId: 'session:1',
      messageId: 'assistant-message:1',
      intent: 'rerun',
    }).success).toBe(false);
    expect(SessionBranchDraftCreatePayloadSchema.safeParse({
      sessionId: 'session:1',
      messageId: 'assistant-message:1',
      createdAt: '2026-07-10T00:00:00.000Z',
    }).success).toBe(false);
    expect(SessionBranchDraftCancelPayloadSchema.safeParse({
      sessionId: 'session:1',
      branchMarkerId: 'branch:1',
      createdAt: '2026-07-10T00:00:00.000Z',
    }).success).toBe(false);
  });

  it('validates Workspace result payloads', () => {
    expect(WorkspaceListProjectsUiResultSchema.safeParse({ projects: [] }).success).toBe(true);
    expect(WorkspaceListProjectsUiResultSchema.safeParse({ projects: 'invalid' }).success).toBe(false);
    expect(WorkspaceListProjectsUiResultSchema.safeParse({
      projects: [{
        projectId: 'workspace:1',
        name: 'megumi',
        rootPath: 'C:/work/megumi',
        rootPathKey: 'c:/work/megumi',
        status: 'available',
      }],
    }).success).toBe(false);
    expect(WorkspaceListProjectsUiResultSchema.safeParse({
      projects: [{
        projectId: 'workspace:1',
        name: 'megumi',
        rootPath: 'C:/work/megumi',
        status: 'available',
      }],
    }).success).toBe(true);
  });

  it('validates Skill result payloads', () => {
    expect(ListSkillsUiResponseSchema.safeParse({ status: 'ok', skills: [] }).success).toBe(true);
    expect(ListSkillsUiResponseSchema.safeParse({
      status: 'failed',
      failure: { code: 'skill_failed', message: 'failed' },
    }).success).toBe(true);
    expect(ListSkillsUiResponseSchema.safeParse({ status: 'failed', message: 'failed' }).success).toBe(false);
  });

  it('validates Settings result payloads', () => {
    expect(ProviderListUiResultSchema.safeParse({ status: 'ok', providers: [], catalog: [] }).success).toBe(true);
    expect(ProviderListUiResultSchema.safeParse({
      status: 'failed',
      failure: { code: 'settings_invalid', message: 'invalid' },
    }).success).toBe(true);
    expect(ProviderListUiResultSchema.safeParse({ providers: [] }).success).toBe(false);
    expect(ProviderListUiResultSchema.safeParse({ status: 'ok', providers: [{ hasApiKey: 'yes' }] }).success).toBe(false);
  });

  it('validates Approval result payloads and rejects non-serializable details', () => {
    expect(ApprovalResolvePayloadSchema.safeParse({
      approvalRequestId: 'approval:1',
      decision: 'approved',
      scope: 'once',
      decidedAt: '2026-07-09T00:00:00.000Z',
    }).success).toBe(false);

    const failure = {
      status: 'failed', approvalRequestId: 'approval:1',
      failure: { code: 'internal_error', message: 'failed', retryable: false },
    };
    expect(ApprovalResolveResultSchema.safeParse(failure).success).toBe(true);
    expect(ApprovalResolveResultSchema.safeParse({
      status: 'resumed',
      approvalRequestId: 'approval:1',
      run: {
        executionId: 'run:1',
        sessionId: 'session:1',
        status: 'running',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
    }).success).toBe(true);
    expect(ApprovalResolveResultSchema.safeParse({
      status: 'not_found',
      approvalRequestId: 'approval:1',
    }).success).toBe(true);
    expect(ApprovalResolveResultSchema.safeParse({
      status: 'resumed',
      data: {
        approval: {
          approvalRecordId: 'approval-record:fake',
          approvalRequestId: 'approval:1',
          toolCallId: 'unknown',
          toolExecutionId: 'unknown',
          executionId: 'unknown',
          stepId: 'unknown',
          decision: 'approved',
          scope: 'once',
          decidedBy: 'user',
          decidedAt: '2026-07-09T00:00:00.000Z',
        },
      },
    }).success).toBe(false);
    expect(ApprovalResolveResultSchema.safeParse({
      ...failure,
      failure: { ...failure.failure, details: { callback: () => undefined } },
    }).success).toBe(false);
  });

  it('rejects malformed or unknown Settings update fields', () => {
    expect(SettingsUpdatePayloadSchema.safeParse({ theme: 123 }).success).toBe(false);
    expect(SettingsUpdatePayloadSchema.safeParse({ unknownSetting: true }).success).toBe(false);
    expect(SettingsUpdatePayloadSchema.safeParse({
      setup: {
        completed: true,
        completedAt: '2026-07-10T00:00:00.000Z',
      },
    }).success).toBe(false);
    expect(SettingsCompleteSetupPayloadSchema.safeParse({
      language: 'zh-CN',
      theme: 'midnight-blue',
    }).success).toBe(true);
    expect(SettingsUpdatePayloadSchema.safeParse({
      theme: 'midnight-blue',
      compaction: { enabled: true, reserveTokens: 16_384 },
    }).success).toBe(false);
    expect(SettingsUpdatePayloadSchema.safeParse({
      discovery: {
        conversationRecognitionEnabled: true,
        dailyGenerationTime: '09:30',
        dailyTargetCount: 24,
        enabledSources: ['bilibili', 'open_web'],
      },
    }).success).toBe(true);
  });
});
