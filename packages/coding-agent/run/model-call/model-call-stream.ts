// Streams a single provider-neutral AI model call into runtime model events.
import type { ModelCallPort } from './model-call-contract';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { mapModelCallToAiInput } from './model-call-request-mapper';
import { adaptAssistantStreamToRuntimeEvents } from './model-event-adapter';
import { systemClock, type Clock, type ModelCallAdapterRequest } from './model-call-contract';

export async function* streamModelCall(input: {
  request: ModelCallAdapterRequest;
  clock?: Clock;
}): AsyncIterable<RuntimeEvent> {
  const aiInput = mapModelCallToAiInput({
    request: input.request.request,
    config: input.request.config,
  });
  const stream = input.request.aiClient.stream({
    model: aiInput.model,
    context: aiInput.context,
    toolSet: aiInput.toolSet,
    signal: input.request.signal,
    credential: { type: 'api_key', value: input.request.config.apiKey },
  });

  yield* adaptAssistantStreamToRuntimeEvents({
    request: input.request,
    stream,
    clock: input.clock ?? systemClock,
  });
}
