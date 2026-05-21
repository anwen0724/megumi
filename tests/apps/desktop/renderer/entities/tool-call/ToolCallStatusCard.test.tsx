// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolCallStatusCard } from '@megumi/desktop/renderer/entities/tool-call';
import type { ToolCall } from '@megumi/shared/tool-contracts';

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolCallId: 'tool-call-1',
    toolUseId: 'tool-use-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'run_command',
    input: { command: 'npm test' },
    inputPreview: {
      summary: 'Run npm test',
      targets: [{ kind: 'command', label: 'npm test' }],
      redactionState: 'none',
    },
    capabilities: ['command_run'],
    riskLevel: 'medium',
    sideEffect: 'execute_command',
    status: 'waiting_for_approval',
    requestedAt: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('ToolCallStatusCard', () => {
  it('renders a shared tool call waiting for approval with policy details', () => {
    render(
      <ToolCallStatusCard
        toolCall={createToolCall({
          policyDecision: {
            permissionDecisionId: 'permission-1',
            toolUseId: 'tool-use-1',
            toolCallId: 'tool-call-1',
            runId: 'run-1',
            decision: 'ask',
            source: 'permission_mode',
            reason: 'Command execution requires approval in default mode.',
            mode: 'default',
            capability: 'command_run',
            sideEffect: 'execute_command',
            effectiveRiskLevel: 'medium',
            requiredApproval: {
              scope: 'run',
              reason: 'Command execution requires approval in default mode.',
            },
            evaluatedAt: '2026-05-20T00:00:01.000Z',
          },
        })}
      />,
    );

    expect(screen.getByText('run_command')).toBeInTheDocument();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    expect(screen.getByText('Run npm test')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
    expect(screen.getByText(/Policy: ask - Command execution requires approval in default mode\./)).toBeInTheDocument();
  });

  it('renders a succeeded tool call with output preview', () => {
    render(
      <ToolCallStatusCard
        toolCall={createToolCall({
          toolName: 'search_text',
          input: { query: 'ThemeProvider' },
          inputPreview: {
            summary: 'Search ThemeProvider',
            targets: [{ kind: 'workspace', label: 'project files' }],
            redactionState: 'none',
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
          status: 'succeeded',
          resultPreview: 'Found 3 matches',
        })}
      />,
    );

    expect(screen.getByText('Succeeded')).toBeInTheDocument();
    expect(screen.getByText('Found 3 matches')).toBeInTheDocument();
  });

  it('renders a failed tool call with the error message', () => {
    render(
      <ToolCallStatusCard
        toolCall={createToolCall({
          status: 'failed',
          error: {
            code: 'tool_execution_failed',
            message: 'Command failed',
            severity: 'error',
            retryable: false,
            source: 'tool',
          },
        })}
      />,
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Command failed')).toBeInTheDocument();
  });
});
