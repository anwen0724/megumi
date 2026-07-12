import { ProtocolRegistryError } from '../core/provider-error';
import { type AiCallRequest } from '../client/ai-call-request';
import { type ProtocolAdapter } from './protocol-adapter';

export class ProtocolRegistry {
    private readonly adapters: Map<string, ProtocolAdapter>;

    constructor(adapters: ProtocolAdapter[]) {
        this.adapters = new Map(
            adapters.map((adapter) => [adapter.protocol, adapter]),
        );
    }

    listProtocols(): string[] {
        return Array.from(this.adapters.keys()).sort();
    }

    has(protocol: string): boolean {
        return this.adapters.has(protocol);
    }

    get(protocol: string): ProtocolAdapter {
        const adapter = this.adapters.get(protocol);

        if (!adapter) {
            throw new ProtocolRegistryError(
                `AI protocol adapter is not registered: ${protocol}`,
            );
        }

        return adapter;
    }

    materialize(request: AiCallRequest): unknown {
        return this.get(request.model.protocol).materialize?.(request);
    }
}
