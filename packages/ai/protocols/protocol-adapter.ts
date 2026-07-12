import { type AssistantEventStream } from '../streaming/assistant-event-stream';
import { type ProtocolAdapterRequest } from './protocol-adapter-request';

export interface ProtocolAdapter {
    readonly protocol: string;

    materialize?(request: ProtocolAdapterRequest): unknown;
    stream(request: ProtocolAdapterRequest): AssistantEventStream;
}

export function createProtocolAdapter(adapter: ProtocolAdapter): ProtocolAdapter {
    return adapter;
}
