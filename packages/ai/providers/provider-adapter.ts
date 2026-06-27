import { type AssistantEventStream } from '../streaming/assistant-event-stream';
import { type ProviderAdapterRequest } from './provider-adapter-request';

export interface ProviderAdapter {
    readonly providerId: string;

    stream(request: ProviderAdapterRequest): AssistantEventStream;
}

export function createProviderAdapter(adapter: ProviderAdapter): ProviderAdapter {
    return adapter;
}