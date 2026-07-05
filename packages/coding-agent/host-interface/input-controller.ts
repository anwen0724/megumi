/*
 * Host-facing input adapter for UI/CLI shells.
 * It maps host DTOs to Agent Run Service calls and does not assemble run internals.
 */
import type { RuntimeContext, RuntimeError, RuntimeEvent } from '@megumi/shared/runtime';
import type { Session } from '@megumi/shared/session';
import type { PermissionMode, PermissionModeState } from '@megumi/shared/permission';
import type { ProviderId } from '@megumi/shared/provider';
import type { RawUserInputAttachment } from '../input';
import type {
  AgentRunEvent,
  AgentRunService,
  StartRunResult,
} from '../agent-run';

export interface HostInputSendRequest {
  requestId?: string;
  sessionId?: string;
  sessionTitle?: string;
  workspaceId?: string;
  workspaceLabel?: string;
  workspacePath?: string;
  providerId: ProviderId | string;
  modelId: string;
  text: string;
  attachments?: RawUserInputAttachment[];
  clientMessageId?: string;
  createdAt?: string;
  permissionMode?: PermissionMode;
  permissionSource?: PermissionModeState['source'];
  runtimeContext?: RuntimeContext;
}

export type HostInputSendResult =
  | {
      type: 'agent_run';
      session: Session;
      requestId: string;
      userMessageId: string;
      runId: string;
      events: AsyncIterable<RuntimeEvent>;
    }
  | {
      type: 'host_interaction_request';
      session?: Session;
      requestId: string;
      request: { kind: string };
    }
  | {
      type: 'completed';
      session?: Session;
      requestId: string;
      message?: string;
    }
  | {
      type: 'error';
      session?: Session;
      requestId: string;
      message: string;
    };

export interface HostInputCancelRequest {
  targetRequestId: string;
}

export interface InputController {
  send(input: HostInputSendRequest): Promise<HostInputSendResult>;
  cancel(input: HostInputCancelRequest): boolean;
}

export type CreateInputControllerOptions = {
  agentRunService: Pick<AgentRunService, 'startRun' | 'cancelRun'>;
  sessionLookup: {
    getSession(sessionId: string): Session | undefined;
  };
};

export function createInputController(options: CreateInputControllerOptions): InputController {
  const runIdByRequestId = new Map<string, string>();

  return {
    async send(input) {
      const requestId = input.requestId ?? `request:${crypto.randomUUID()}`;
      const result = await options.agentRunService.startRun({
        request_id: requestId,
        workspace_id: requireWorkspaceId(input),
        session: input.sessionId
          ? { type: 'existing', session_id: input.sessionId }
          : { type: 'new', ...(input.sessionTitle ? { title: input.sessionTitle } : {}) },
        user_input: {
          text: input.text,
          ...(input.attachments ? { attachments: input.attachments } : {}),
        },
        model_selection: {
          provider_id: String(input.providerId),
          model_id: input.modelId,
        },
        permission_mode: input.permissionMode ?? 'default',
      });
      const mapped = mapStartRunResult(result, options.sessionLookup, input);
      if (mapped.type === 'agent_run') {
        runIdByRequestId.set(mapped.requestId, mapped.runId);
      }
      return mapped;
    },

    cancel(input) {
      const runId = runIdByRequestId.get(input.targetRequestId) ?? input.targetRequestId;
      const result = options.agentRunService.cancelRun({ run_id: runId });
      if (result instanceof Promise) {
        void result;
        return true;
      }
      return result.status === 'cancelled';
    },
  };
}

function mapStartRunResult(
  result: StartRunResult,
  sessionLookup: CreateInputControllerOptions['sessionLookup'],
  input: HostInputSendRequest,
): HostInputSendResult {
  if (result.status === 'started') {
    return {
      type: 'agent_run',
      session: sessionLookup.getSession(result.session_id) ?? fallbackSession(result.session_id, input),
      requestId: result.request_id,
      userMessageId: result.user_message_id,
      runId: result.run.run_id,
      events: mapAgentRunEvents(result.events, result.request_id),
    };
  }

  if (result.status === 'host_interaction_required') {
    return {
      type: 'host_interaction_request',
      ...(result.session_id ? { session: sessionLookup.getSession(result.session_id) ?? fallbackSession(result.session_id, input) } : {}),
      requestId: result.request_id,
      request: result.interaction,
    };
  }

  if (result.status === 'completed') {
    return {
      type: 'completed',
      ...(result.session_id ? { session: sessionLookup.getSession(result.session_id) ?? fallbackSession(result.session_id, input) } : {}),
      requestId: result.request_id,
      ...(result.message ? { message: result.message } : {}),
    };
  }

  return {
    type: 'error',
    ...(result.session_id ? { session: sessionLookup.getSession(result.session_id) ?? fallbackSession(result.session_id, input) } : {}),
    requestId: result.request_id,
    message: result.failure.message,
  };
}

export async function* mapAgentRunEvents(
  events: AsyncIterable<AgentRunEvent>,
  requestId: string,
): AsyncIterable<RuntimeEvent> {
  let sequence = 0;
  for await (const event of events) {
    const mapped = toRuntimeEvent(event, requestId, sequence + 1);
    if (mapped) {
      sequence += 1;
      yield mapped;
    }
  }
}

function toRuntimeEvent(event: AgentRunEvent, requestId: string, sequence: number): RuntimeEvent | undefined {
  const base = {
    eventId: event.event_id,
    schemaVersion: 1 as const,
    ...(event.run_id ? { runId: event.run_id } : {}),
    ...(event.session_id ? { sessionId: event.session_id } : {}),
    requestId,
    sequence,
    createdAt: event.created_at,
    source: 'core' as const,
    visibility: 'user' as const,
    persist: 'transient' as const,
  };

  if (event.type === 'run.started') {
    return {
      ...base,
      eventType: 'run.started',
      payload: {
        providerId: stringPayload(event, 'provider_id'),
        modelId: stringPayload(event, 'model_id'),
        runKind: 'agent',
      },
    };
  }
  if (event.type === 'model_call.text_delta') {
    return {
      ...base,
      eventType: 'assistant.output.delta',
      payload: { delta: stringPayload(event, 'delta') ?? '' },
    };
  }
  if (event.type === 'model_call.completed') {
    return {
      ...base,
      eventType: 'assistant.output.completed',
      payload: { content: stringPayload(event, 'content') ?? '' },
    };
  }
  if (event.type === 'model_call.tool_call') {
    return {
      ...base,
      eventType: 'tool.call.created',
      payload: {
        toolCallId: stringPayload(event, 'tool_call_id') ?? stringPayload(event, 'toolCallId') ?? event.event_id,
        toolName: stringPayload(event, 'tool_name') ?? stringPayload(event, 'toolName') ?? '',
        input: event.payload?.input ?? {},
      },
    } as RuntimeEvent;
  }
  if (event.type === 'tool_call.completed') {
    return {
      ...base,
      eventType: 'tool.execution.completed',
      payload: {
        toolCallId: stringPayload(event, 'tool_call_id') ?? event.event_id,
        toolName: stringPayload(event, 'tool_name') ?? '',
      },
    } as RuntimeEvent;
  }
  if (event.type === 'tool_call.failed') {
    return {
      ...base,
      eventType: 'tool.execution.failed',
      payload: {
        toolCallId: stringPayload(event, 'tool_call_id') ?? event.event_id,
        toolName: stringPayload(event, 'tool_name') ?? '',
      },
    } as RuntimeEvent;
  }
  if (event.type === 'tool_call.denied') {
    return {
      ...base,
      eventType: 'tool.execution.denied',
      payload: {
        toolCallId: stringPayload(event, 'tool_call_id') ?? event.event_id,
        toolName: stringPayload(event, 'tool_name') ?? '',
      },
    } as RuntimeEvent;
  }
  if (event.type === 'tool_result.created') {
    return {
      ...base,
      eventType: 'tool.result.created',
      payload: {
        toolCallId: stringPayload(event, 'tool_call_id') ?? event.event_id,
        toolName: stringPayload(event, 'tool_name') ?? '',
        status: stringPayload(event, 'status') ?? 'completed',
        content: stringPayload(event, 'content') ?? '',
      },
    } as RuntimeEvent;
  }
  if (event.type === 'approval.requested') {
    const approvalRequestId = stringPayload(event, 'approval_request_id') ?? event.event_id;
    return {
      ...base,
      eventType: 'approval.requested',
      payload: {
        approvalRequest: {
          approvalRequestId,
          runId: event.run_id ?? '',
        },
      },
    } as RuntimeEvent;
  }
  if (event.type === 'run.completed') {
    return {
      ...base,
      eventType: 'run.completed',
      payload: {},
    };
  }
  if (event.type === 'run.failed') {
    return {
      ...base,
      eventType: 'run.failed',
      payload: {
        error: runtimeErrorFromAgentEvent(event),
      },
    };
  }
  return undefined;
}

function runtimeErrorFromAgentEvent(event: AgentRunEvent): RuntimeError {
  const failure = event.payload?.failure;
  if (failure && typeof failure === 'object' && 'message' in failure) {
    return {
      code: 'runtime_unknown',
      message: typeof failure.message === 'string' ? failure.message : 'Agent Run failed.',
      severity: 'error',
      retryable: false,
      source: 'core',
    };
  }
  return {
    code: 'runtime_unknown',
    message: 'Agent Run failed.',
    severity: 'error',
    retryable: false,
    source: 'core',
  };
}

function stringPayload(event: AgentRunEvent, key: string): string | undefined {
  const value = event.payload?.[key];
  return typeof value === 'string' ? value : undefined;
}

function fallbackSession(sessionId: string, input: HostInputSendRequest): Session {
  return {
    sessionId,
    title: input.sessionTitle ?? 'Session',
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    status: 'active',
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.createdAt ?? new Date().toISOString(),
  };
}

function requireWorkspaceId(input: HostInputSendRequest): string {
  if (!input.workspaceId) {
    throw new Error('Agent Run host input requires workspaceId.');
  }
  return input.workspaceId;
}
