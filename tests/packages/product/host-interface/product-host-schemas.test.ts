import { describe, expect, it } from 'vitest';
import {
  ApprovalResolvePayloadSchema,
  ChatSendUserInputUiPayloadSchema,
  SessionMessageSendPayloadSchema,
  SkillGetPayloadSchema,
  WorkspaceFilesListPayloadSchema,
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
    expect(ApprovalResolvePayloadSchema.safeParse({ approvalRequestId: 'a', decision: 'maybe' }).success).toBe(false);
  });

  it('validates every legal serializable Chat result branch', () => {
    expect(ChatSendUserInputUiPayloadSchema.safeParse({
      type: 'completed', requestId: 'request:1', message: 'done',
    }).success).toBe(true);
    expect(ChatSendUserInputUiPayloadSchema.safeParse({
      type: 'error', requestId: 'request:1', message: 'failed', events: [],
    }).success).toBe(false);
  });
});
