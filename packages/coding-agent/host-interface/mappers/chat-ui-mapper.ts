/*
 * Maps session and agent-run facts into host-facing chat UI DTOs.
 */
import type { AgentRun, AgentRunEvent } from '../../agent-run';
import type { RuntimeError, RuntimeEvent } from '../../events';
import type { Session, SessionMessageWithAttachments } from '../../session';
import type {
  ChatRunUiDto,
  ChatSessionMessageUiDto,
  ChatSessionUiDto,
} from '../contracts/chat-ui-contracts';

export function toChatSessionUiDto(session: Session): ChatSessionUiDto {
  return {
    id: session.session_id,
    projectId: session.workspace_id,
    title: session.title,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

export function toChatMessageUiDto(item: SessionMessageWithAttachments): ChatSessionMessageUiDto {
  const { message } = item;
  return {
    id: message.message_id,
    sessionId: message.session_id,
    ...(message.run_id ? { runId: message.run_id } : {}),
    role: message.role,
    text: message.content_text,
    createdAt: message.created_at,
  };
}

export function toChatRunUiDto(run: AgentRun): ChatRunUiDto {
  return {
    runId: run.run_id,
    sessionId: run.session_id,
    status: run.status,
    createdAt: run.created_at,
    ...(run.completed_at ? { completedAt: run.completed_at } : {}),
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

export function toRuntimeEvent(event: AgentRunEvent, requestId: string, sequence: number): RuntimeEvent | undefined {
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
    return {
      ...base,
      eventType: 'approval.requested',
      payload: {
        approvalRequest: {
          approvalRequestId: stringPayload(event, 'approval_request_id') ?? event.event_id,
          runId: event.run_id ?? '',
        },
      },
    } as RuntimeEvent;
  }
  if (event.type === 'run.completed') {
    return { ...base, eventType: 'run.completed', payload: {} };
  }
  if (event.type === 'run.failed') {
    return {
      ...base,
      eventType: 'run.failed',
      payload: { error: runtimeErrorFromAgentEvent(event) },
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
