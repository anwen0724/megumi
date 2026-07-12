import { describe, expect, it } from 'vitest';
import type {
  AgentRun,
  AgentRunToolCall,
  RunStep,
  CancelRunResult,
  ResumeRunAfterApprovalResult,
  StartRunRequest,
  StartRunResult,
} from '@megumi/coding-agent/agent-run';
import type { ToolSet } from '@megumi/ai';

describe('agent-run public contracts', () => {
  it('defines start run request and result shapes', () => {
    const request = {
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'hello', attachments: [] },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      permission_mode: 'default',
    } satisfies StartRunRequest;

    expect(request.request_id).toBe('request-1');
    expect(request.workspace_id).toBe('workspace-1');
    expect(request.model_selection.provider_id).toBe('deepseek');

    const statuses: StartRunResult['status'][] = [
      'started',
      'host_interaction_required',
      'completed',
      'failed',
    ];
    expect(statuses).toEqual(['started', 'host_interaction_required', 'completed', 'failed']);
  });

  it('defines run control result shapes', () => {
    const cancelStatuses: CancelRunResult['status'][] = [
      'cancelled',
      'not_found',
      'not_cancellable',
      'failed',
    ];
    const resumeStatuses: ResumeRunAfterApprovalResult['status'][] = [
      'resumed',
      'not_found',
      'not_waiting',
      'failed',
    ];

    expect(cancelStatuses).toContain('not_cancellable');
    expect(resumeStatuses).toContain('not_waiting');
  });

  it('defines persisted run and tool runtime shapes', () => {
    const run = {
      run_id: 'run-1',
      workspace_id: 'workspace-1',
      session_id: 'session-1',
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      trigger: { type: 'user_input', user_message_id: 'message-1' },
      status: 'queued',
      created_at: '2026-01-01T00:00:00.000Z',
    } satisfies AgentRun;
    const toolCall = {
      tool_call_id: 'tool-call-1',
      run_id: run.run_id,
      type: 'tool_call',
      source_model_call_id: 'model-call-1',
      call_order: 0,
      tool_name: 'read_file',
      input: { path: 'README.md' },
      arguments_text: '{"path":"README.md"}',
      status: 'requested',
      created_at: run.created_at,
    } satisfies AgentRunToolCall;

    expect(run.status).toBe('queued');
    expect(toolCall.call_order).toBe(0);
    const steps: RunStep[] = [{
      type: 'model_call',
      run_id: run.run_id,
      model_call_id: 'model-call-1',
      status: 'running',
      started_at: run.created_at,
    }, toolCall];
    expect(steps.map((step) => step.type)).toEqual(['model_call', 'tool_call']);
    expect(steps.every((step) => !('step_id' in step))).toBe(true);
  });

  it('defines run-level ToolSet', () => {
    const tools = [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object' },
        },
      ] satisfies ToolSet;

    expect(tools[0]?.name).toBe('read_file');
  });
});
