import { type AiCallRequest } from '../client/ai-call-request';
import { type CredentialResolver } from '../client/ai-client-options';

export interface ProtocolAdapterRequest extends AiCallRequest {
    credentialResolver?: CredentialResolver;
}
