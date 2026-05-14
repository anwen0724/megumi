import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { RunId } from '@megumi/shared/ids';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

export interface AiPortStreamInput {
  request: ChatRuntimeRequest;
  runId: RunId | string;
  signal?: AbortSignal;
  nextSequence: () => number;
  eventIdFactory: () => string;
}

export interface AiPort {
  streamChat(input: AiPortStreamInput): AsyncIterable<RuntimeEvent>;
}
