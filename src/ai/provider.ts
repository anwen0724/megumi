// Defines provider adapter contracts for model access.
import { type AssistantMessageEventStream } from './event-stream';
import { type ProviderAdapterRequest } from './request';

export interface ProviderAdapter {
  readonly providerId: string;
  stream(request: ProviderAdapterRequest): AssistantMessageEventStream;
}

export function createProviderAdapter(adapter: ProviderAdapter): ProviderAdapter {
  return adapter;
}
