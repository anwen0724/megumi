// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from '@megumi/desktop/renderer/entities/approval';
import { ToolCallStatusCard } from '@megumi/desktop/renderer/entities/tool-call';
import { Composer } from '@megumi/desktop/renderer/features/chat/components/Composer';

describe('agent action permission tools v1 renderer acceptance', () => {
  it('offers one permission selector with the v1 posture set', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    const permissionModeSelect = screen.getByLabelText('Permission mode') as HTMLSelectElement;

    expect(permissionModeSelect).toHaveValue('default');
    expect(Array.from(permissionModeSelect.options).map((option) => option.value)).toEqual([
      'default',
      'accept_edits',
      'plan',
      'auto',
    ]);
    expect(screen.queryByLabelText('Composer mode')).not.toBeInTheDocument();

    await user.selectOptions(permissionModeSelect, 'auto');
    await user.type(screen.getByLabelText('Message Megumi'), 'Fix tests');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Fix tests',
      permissionMode: 'auto',
    }));
  });

  it('renders policy decision reason for auto audit on tool calls', () => {
    render(<ToolCallStatusCard toolCall={{
      toolCallId: 'tool-call-1',
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'edit_file',
      input: { path: 'src/index.ts' },
      inputPreview: {
        summary: 'Edit src/index.ts',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      capabilities: ['project_write'],
      riskLevel: 'medium',
      sideEffect: 'project_file_operation',
      policyDecision: {
        permissionDecisionId: 'permission-decision-1',
        toolUseId: 'tool-use-1',
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        decision: 'allow',
        source: 'classifier',
        reason: 'Auto allowed ordinary project edit.',
        mode: 'auto',
        classifierLabel: 'project_file_operation',
        target: 'src/index.ts',
        capability: 'project_write',
        sideEffect: 'project_file_operation',
        effectiveRiskLevel: 'medium',
        evaluatedAt: '2026-05-20T00:00:00.000Z',
      },
      status: 'succeeded',
      requestedAt: '2026-05-20T00:00:00.000Z',
      completedAt: '2026-05-20T00:00:01.000Z',
    }} />);

    expect(screen.getByText('edit_file')).toBeInTheDocument();
    expect(screen.getByText(/Auto allowed ordinary project edit/)).toBeInTheDocument();
  });

  it('resolves approval requests through a single onResolve callback', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(<ApprovalCard request={{
      approvalRequestId: 'approval-1',
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
      permissionDecisionId: 'permission-decision-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'run_command',
      capabilities: ['command_run'],
      riskLevel: 'medium',
      title: 'Approve run_command',
      summary: 'Run npm test',
      preview: {
        action: 'Run command',
        targets: [{ kind: 'command', label: 'npm test', sensitivity: 'normal' }],
      },
      requestedScope: 'once',
      status: 'pending',
      createdAt: '2026-05-20T00:00:00.000Z',
    }} onResolve={onResolve} />);

    await user.selectOptions(screen.getByLabelText('Approval scope'), 'run');
    await user.click(screen.getByRole('button', { name: 'Approve run_command' }));

    expect(onResolve).toHaveBeenCalledWith({
      approvalRequestId: 'approval-1',
      decision: 'approved',
      scope: 'run',
    });
  });
});
