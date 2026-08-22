/* Verifies the Tool adapter: route, permissions, approval waits inside AgentTool.execute, and execution. */
import { describe, expect, it, vi } from 'vitest';
import type { AgentToolExecutionOutcome } from '@megumi/agent';
import { createEventBus, type AnyEvent } from '@megumi/events';
import type { PermissionDecision, Permissions } from '@megumi/permissions';
import type { ModelCallToolBinding, ToolDefinition } from '@megumi/tools';
import {
  createAgentTool,
  type DiscoveryAgentToolResultDetails,
  type ToolAdapterDependencies,
} from '../../../packages/discovery-agent/src/execution/tool-adapter';
import type { ToolScope } from '../../../packages/discovery-agent/src/execution/context-adapter';
import type { ExecutionObserver } from '../../../packages/discovery-agent/src/execution/execution-observer';
import { executionMetadata } from './execution-test-fixtures';
import {
  allowDecision,
  approvalSubjectFor,
  permissionService,
  registeredTool,
  restrictedExecutionAccess,
  succeeded,
} from './tool-call-test-fixtures';

const metadata = executionMetadata();

const observer: ExecutionObserver = {
  start: () => undefined,
  end: () => undefined,
  startSpan: () => undefined,
  endSpan: () => undefined,
  recordLog: () => undefined,
  recordMeasurement: () => undefined,
};

type TestDependencies = ToolAdapterDependencies & { readonly binding: ModelCallToolBinding };

function toolDependencies(
  overrides: Partial<ToolAdapterDependencies> & { readonly binding?: Partial<ModelCallToolBinding> } = {},
): TestDependencies {
  const eventsBus = createEventBus();
  const routeToolCall = ((request: { toolCallId: string; toolName: string; input: unknown; modelCallId: string }) => ({
    status: 'routed' as const,
    invocation: {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      toolIdentity: { sourceId: 'built_in', namespace: 'megumi', sourceToolName: request.toolName },
      input: request.input,
      modelCallId: request.modelCallId,
    },
    operations: [{
      action: 'agent.context.activate',
      context: {
        workspaceId: metadata.workspaceId,
        sessionId: metadata.sessionId,
        executionId: metadata.executionId,
        toolIdentity: { sourceId: 'built_in', namespace: 'megumi', sourceToolName: request.toolName },
      },
    }],
  })) as never;
  const binding: ModelCallToolBinding = {
    modelCallId: 'model-call:1',
    definitions: [],
    routeToolCall,
    executeToolInvocation: (async () => succeeded('lookup')) as never,
    close: () => undefined,
    ...overrides.binding,
  };
  const { binding: _binding, ...dependencyOverrides } = overrides;
  return {
    metadata,
    permissions: permissionService(),
    ids: {
      createToolExecutionId: () => 'tool-execution:1',
      createApprovalId: () => 'approval:1',
    },
    clock: { now: () => '2026-07-31T00:00:00.000Z' },
    events: eventsBus,
    observer,
    awaitApproval: async () => ({ status: 'cancelled' as const }),
    toolSystemFailures: new Map(),
    ...dependencyOverrides,
    binding,
  };
}

function scopeFor(definition: ToolDefinition, binding: ModelCallToolBinding): ToolScope {
  return {
    modelCallId: 'model-call:1',
    binding,
    definitions: [definition],
    tools: [],
    released: false,
  };
}

function invocationFor(toolName: string, toolCallId: string) {
  return {
    toolCallId,
    toolName,
    toolIdentity: { sourceId: 'built_in', namespace: 'megumi', sourceToolName: toolName },
    input: { value: 'x' },
    modelCallId: 'model-call:1',
  };
}

async function execute(
  dependencies: TestDependencies,
  tool: { readonly name: string; readonly id?: string },
  signal: AbortSignal = new AbortController().signal,
  updates: unknown[] = [],
): Promise<AgentToolExecutionOutcome<DiscoveryAgentToolResultDetails>> {
  const definition = registeredTool(tool.name).definition as ToolDefinition;
  const agentTool = createAgentTool(dependencies)(definition, scopeFor(definition, dependencies.binding));
  return agentTool.execute({
    toolCallId: tool.id ?? 'call:1',
    arguments: { value: 'x' },
    signal,
    onUpdate: (update) => { updates.push(update); },
  }) as Promise<AgentToolExecutionOutcome<DiscoveryAgentToolResultDetails>>;
}

describe('Tool Adapter', () => {
  it('routes and executes an allowed Tool with settled details', async () => {
    const updates: unknown[] = [];
    const dependencies = toolDependencies();
    const result = await execute(dependencies, { name: 'lookup' }, new AbortController().signal, updates);

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('unreachable');
    expect(result.result).toMatchObject({
      isError: false,
      details: { kind: 'settled', status: 'success', content: 'result:lookup' },
    });
    expect(updates[0]).toMatchObject({
      details: { kind: 'execution_started', toolExecutionId: 'tool-execution:1' },
    });
  });

  it('keeps a route failure model-visible as a settled failure', async () => {
    const dependencies = toolDependencies({
      binding: {
        routeToolCall: (() => ({
          status: 'failed' as const,
          error: { code: 'tool_not_found', message: 'Tool is unavailable.' },
        })) as never,
        executeToolInvocation: (async () => succeeded('unused')) as never,
      },
    });
    const result = await execute(dependencies, { name: 'lookup' });
    expect(result).toMatchObject({
      status: 'completed',
      result: {
        isError: true,
        details: { status: 'failure', error: { code: 'tool_not_found' } },
      },
    });
  });

  it('turns a permission denial into a model-visible settled denial', async () => {
    const dependencies = toolDependencies({
      permissions: permissionService((request): PermissionDecision => ({
        type: 'deny',
        operations: [...request.operations],
        safetyAssessment: 'prohibited',
        safetySummary: 'Denied.',
        reason: 'Denied in test.',
        denialCode: 'rule_denied',
      })),
    });
    const result = await execute(dependencies, { name: 'lookup' });
    expect(result).toMatchObject({
      status: 'completed',
      result: {
        isError: true,
        details: { status: 'permission_denied', error: { code: 'rule_denied' } },
      },
    });
  });

  it('awaits the approval decision inside the original AgentTool Promise before executing', async () => {
    const events: AnyEvent[] = [];
    const eventsBus = createEventBus();
    eventsBus.subscribe({}, (event) => { events.push(event); });
    const awaitApproval = vi.fn(async ({ approval }: Parameters<ToolAdapterDependencies['awaitApproval']>[0]) => {
      expect(approval).toMatchObject({
        approvalId: 'approval:1',
        executionId: 'execution:1',
        toolCallId: 'call:1',
        toolName: 'lookup',
        status: 'pending',
      });
      return {
        status: 'approved' as const,
        decision: {
          approvalRequestId: approval.approvalId,
          decision: 'approved' as const,
          optionId: approval.defaultOptionId,
          decidedBy: 'user' as const,
          decidedAt: '2026-07-31T00:00:00.000Z',
        },
      };
    });
    const dependencies = toolDependencies({
      permissions: permissionService((request): PermissionDecision => {
        const allowed = allowDecision(request);
        const subject = approvalSubjectFor(request, allowed);
        return {
          ...allowed,
          type: 'requires_approval',
          reason: 'Approval required.',
          options: [{
            optionId: 'once:1',
            scope: 'once',
            display: { label: 'Once', description: 'Allow once.' },
            effect: { type: 'current_tool_call' },
          }],
          defaultOptionId: 'once:1',
          subjectFingerprint: subject.fingerprint,
        };
      }),
      events: eventsBus,
      awaitApproval,
    });

    const result = await execute(dependencies, { name: 'lookup' });
    expect(awaitApproval).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 'completed',
      result: { details: { status: 'success' } },
    });
    expect(events.map((event) => event.type)).toEqual(['approval.requested', 'approval.resolved']);
    expect(events[0]).toMatchObject({ payload: { approvalRequestId: 'approval:1' }, executionId: 'execution:1' });
  });

  it('turns a denied approval into a model-visible rejection', async () => {
    const dependencies = toolDependencies({
      permissions: permissionService((request): PermissionDecision => {
        const allowed = allowDecision(request);
        return {
          ...allowed,
          type: 'requires_approval',
          reason: 'Approval required.',
          options: [{
            optionId: 'once:1',
            scope: 'once',
            display: { label: 'Once', description: 'Allow once.' },
            effect: { type: 'current_tool_call' },
          }],
          defaultOptionId: 'once:1',
          subjectFingerprint: 'test-subject',
        };
      }),
      awaitApproval: async ({ approval }) => ({
        status: 'denied',
        decision: {
          approvalRequestId: approval.approvalId,
          decision: 'denied',
          decidedBy: 'user',
          decidedAt: '2026-07-31T00:00:00.000Z',
        },
      }),
    });
    const result = await execute(dependencies, { name: 'lookup' });
    expect(result).toMatchObject({
      status: 'completed',
      result: { details: { status: 'user_rejected' } },
    });
  });

  it('turns a cancelled approval wait into a cancelled Tool result', async () => {
    const dependencies = toolDependencies({
      permissions: permissionService((request): PermissionDecision => {
        const allowed = allowDecision(request);
        return {
          ...allowed,
          type: 'requires_approval',
          reason: 'Approval required.',
          options: [{
            optionId: 'once:1',
            scope: 'once',
            display: { label: 'Once', description: 'Allow once.' },
            effect: { type: 'current_tool_call' },
          }],
          defaultOptionId: 'once:1',
          subjectFingerprint: 'test-subject',
        };
      }),
      awaitApproval: async () => ({ status: 'cancelled' }),
    });
    const result = await execute(dependencies, { name: 'lookup' });
    expect(result).toMatchObject({
      status: 'completed',
      result: {
        isError: true,
        details: { status: 'cancelled', error: { code: 'tool_cancelled' } },
      },
    });
  });

  it('reports a permission evaluation failure as a tool system failure', async () => {
    const failures = new Map();
    const dependencies = toolDependencies({
      permissions: {
        evaluateToolCall: vi.fn(async () => { throw new Error('permission evaluation exploded'); }),
        applyApprovalDecision: vi.fn(async () => ({ status: 'failed' as const })),
      } as unknown as Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>,
      toolSystemFailures: failures,
    });
    const result = await execute(dependencies, { name: 'lookup' });
    expect(result).toMatchObject({
      status: 'system_failed',
      error: { code: 'tool_system_failed', cause: { owner: 'permissions', code: 'permission_evaluation_threw' } },
    });
    expect(failures.has('call:1')).toBe(true);
  });

  it('keeps Tool execution exceptions as model-visible failures with settled details', async () => {
    const dependencies = toolDependencies({
      binding: {
        routeToolCall: (() => ({
          status: 'routed' as const,
          invocation: invocationFor('lookup', 'call:1'),
          operations: [],
        })) as never,
        executeToolInvocation: (async () => { throw new Error('tool exploded'); }) as never,
      },
    });
    const result = await execute(dependencies, { name: 'lookup' });
    expect(result).toMatchObject({
      status: 'completed',
      result: {
        isError: true,
        details: {
          status: 'failure',
          error: { code: 'tool_execution_failed', message: 'Tool execution failed.' },
        },
      },
    });
  });

  it('propagates the Agent root signal into the Tool execution', async () => {
    const controller = new AbortController();
    const executeToolInvocation = vi.fn(async (
      _input: never,
      options?: { readonly signal?: AbortSignal },
    ) => {
      await new Promise<void>((resolve) => {
        options?.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return { type: 'failed' as const, toolName: 'lookup', error: { code: 'tool_cancelled', message: 'cancelled' }, normalizedResult: { kind: 'text' as const, content: 'cancelled', isError: true, truncated: false } };
    });
    const dependencies = toolDependencies({
      binding: {
        routeToolCall: (() => ({
          status: 'routed' as const,
          invocation: invocationFor('lookup', 'call:1'),
          operations: [],
        })) as never,
        executeToolInvocation: executeToolInvocation as never,
      },
    });
    const execution = execute(dependencies, { name: 'lookup' }, controller.signal);
    await vi.waitFor(() => expect(executeToolInvocation).toHaveBeenCalledTimes(1));
    controller.abort();
    const result = await execution;
    expect(result).toMatchObject({
      status: 'completed',
      result: { details: { status: 'cancelled' } },
    });
  });
});
