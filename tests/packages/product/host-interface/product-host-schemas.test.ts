import { describe, expect, it } from 'vitest';
import {
  ApprovalResolvePayloadSchema,
  ApprovalResolveResultSchema,
  ArtifactGetDataSchema,
  ArtifactReferencePayloadSchema,
  ArtifactStatusUpdatePayloadSchema,
  ArtifactVersionCreatePayloadSchema,
  ChatCancelUserInputUiPayloadSchema,
  ChatCreateSessionUiResultSchema,
  ChatListSessionsUiResultSchema,
  ChatSendUserInputUiPayloadSchema,
  ListSkillsUiResponseSchema,
  ProviderListUiResultSchema,
  PlanStatusUpdatePayloadSchema,
  SessionBranchDraftCancelPayloadSchema,
  SessionBranchDraftCreatePayloadSchema,
  SettingsCompleteSetupPayloadSchema,
  SettingsUpdatePayloadSchema,
  SessionMessageSendPayloadSchema,
  SkillDisablePayloadSchema,
  SkillGetPayloadSchema,
  WorkspaceFilesListPayloadSchema,
  WorkspaceListProjectsUiResultSchema,
} from '@megumi/product/host-interface';

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
  });

  it('owns Workspace, Skill, and Approval request validation', () => {
    expect(WorkspaceFilesListPayloadSchema.parse({ projectId: 'workspace:1', directoryPath: '' })).toBeDefined();
    expect(SkillGetPayloadSchema.parse({ skillId: 'review' })).toBeDefined();
    expect(SkillDisablePayloadSchema.safeParse({
      skillId: 'writing-plans',
      reason: 'not used by owner',
    }).success).toBe(false);
    expect(ApprovalResolvePayloadSchema.safeParse({ approvalRequestId: 'a', decision: 'maybe' }).success).toBe(false);
  });

  it('validates every legal serializable Chat result branch', () => {
    expect(ChatCreateSessionUiResultSchema.safeParse({
      status: 'failed',
      failure: { code: 'session_failed', message: 'failed' },
    }).success).toBe(true);
    expect(ChatListSessionsUiResultSchema.safeParse({ status: 'ok', sessions: [] }).success).toBe(true);
    expect(ChatListSessionsUiResultSchema.safeParse({ sessions: [] }).success).toBe(false);
    expect(ChatSendUserInputUiPayloadSchema.safeParse({
      type: 'completed', requestId: 'request:1', message: 'done',
    }).success).toBe(true);
    expect(ChatSendUserInputUiPayloadSchema.safeParse({
      type: 'error', requestId: 'request:1', message: 'failed', events: [],
    }).success).toBe(false);
    expect(ChatSendUserInputUiPayloadSchema.safeParse({
      type: 'host_interaction_request',
      requestId: 'request:1',
      request: { kind: 'context_compaction', callback: () => undefined },
    }).success).toBe(false);
  });

  it('validates structured Chat cancel results', () => {
    expect(ChatCancelUserInputUiPayloadSchema.safeParse({ cancelled: false }).success).toBe(false);
    expect(ChatCancelUserInputUiPayloadSchema.safeParse({ status: 'cancelled' }).success).toBe(true);
    expect(ChatCancelUserInputUiPayloadSchema.safeParse({ status: 'not_found', runId: 'run:1' }).success).toBe(true);
    expect(ChatCancelUserInputUiPayloadSchema.safeParse({
      status: 'not_cancellable',
      reason: 'already_terminal',
      run: {
        runId: 'run:1',
        sessionId: 'session:1',
        status: 'completed',
        createdAt: '2026-07-10T00:00:00.000Z',
        completedAt: '2026-07-10T00:01:00.000Z',
      },
    }).success).toBe(true);
    expect(ChatCancelUserInputUiPayloadSchema.safeParse({
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
    expect(ProviderListUiResultSchema.safeParse({ status: 'ok', providers: [] }).success).toBe(true);
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
      failure: { code: 'approval_failed', message: 'failed', retryable: false },
    };
    expect(ApprovalResolveResultSchema.safeParse(failure).success).toBe(true);
    expect(ApprovalResolveResultSchema.safeParse({
      status: 'resumed',
      approvalRequestId: 'approval:1',
      run: {
        runId: 'run:1',
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
          runId: 'unknown',
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

  it('validates Artifact result payloads without fabricated relations', () => {
    expect(ArtifactGetDataSchema.safeParse({
      artifact: undefined, currentVersion: undefined, sourceRefs: [],
    }).success).toBe(true);
    expect(ArtifactGetDataSchema.safeParse({
      artifact: undefined, currentVersion: undefined, sourceRefs: [], relations: [],
    }).success).toBe(false);
  });

  it('rejects renderer-provided Artifact and Plan canonical timestamps', () => {
    expect(ArtifactVersionCreatePayloadSchema.safeParse({
      artifactId: 'artifact:1',
      contentType: 'markdown',
      contentFormat: 'text/markdown',
      text: '# Plan',
      textPreview: '# Plan',
      createdByRunId: 'run:1',
      createdAt: '2026-05-16T00:00:00.000Z',
    }).success).toBe(false);
    expect(ArtifactStatusUpdatePayloadSchema.safeParse({
      artifactId: 'artifact:1',
      status: 'active',
      updatedAt: '2026-05-16T00:00:00.000Z',
    }).success).toBe(false);
    expect(ArtifactReferencePayloadSchema.safeParse({
      artifactId: 'artifact:1',
      referencedByKind: 'run',
      referencedById: 'run:1',
      createdAt: '2026-05-16T00:00:00.000Z',
    }).success).toBe(false);
    expect(PlanStatusUpdatePayloadSchema.safeParse({
      planArtifactId: 'plan:1',
      status: 'accepted',
      updatedAt: '2026-05-16T00:00:00.000Z',
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
    }).success).toBe(true);
  });
});
