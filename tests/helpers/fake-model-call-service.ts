/* Test-only Model Call Service for Product and composition integration boundaries. */
import type { AssistantMessage } from '@megumi/ai';
import type {
  ModelCallRequest,
  ModelCallService,
} from '@megumi/agent/agent-run';

export function fakeModelCallService(
  text = 'ok',
  onCall?: (request: ModelCallRequest) => void,
): ModelCallService {
  return {
    modelCall(request) {
      onCall?.(request);
      const modelCallId = `model-call:${crypto.randomUUID()}`;
      return {
        status: 'started',
        model_call_id: modelCallId,
        events: events(modelCallId, text, request),
      };
    },
    cancelModelCall(request) {
      return { status: 'not_cancellable', model_call_id: request.model_call_id };
    },
  };
}

async function* events(modelCallId: string, text: string, request: ModelCallRequest) {
  const timestamp = Date.now();
  const createdAt = new Date(timestamp).toISOString();
  const message: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: request.model_config.api,
    provider: request.model_config.provider_id,
    model: request.model_config.model_id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp,
  };
  yield { type: 'started' as const, model_call_id: modelCallId, created_at: createdAt };
  yield { type: 'text_delta' as const, model_call_id: modelCallId, delta: text, created_at: createdAt };
  yield {
    type: 'completed' as const,
    model_call_id: modelCallId,
    content: text,
    finish_reason: 'stop',
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    assistant_message: message,
    created_at: createdAt,
  };
}
