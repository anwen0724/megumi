/*
 * Model Call Service public factory.
 * The provider adapter implementation is added by the model-call task.
 */
import type {
  CancelModelCallRequest,
  CancelModelCallResult,
  ModelCallRequest,
  ModelCallResult,
  ModelCallService,
} from '../contracts/model-call-contracts';

export type CreateModelCallServiceOptions = Record<string, never>;

export function createModelCallService(_options: CreateModelCallServiceOptions = {}): ModelCallService {
  return {
    modelCall(_request: ModelCallRequest): ModelCallResult {
      return {
        status: 'failed',
        failure: {
          code: 'model_call_failed',
          message: 'Model Call Service is not implemented yet.',
          retryable: false,
        },
      };
    },
    cancelModelCall(request: CancelModelCallRequest): CancelModelCallResult {
      return { status: 'not_found', model_call_id: request.model_call_id };
    },
  };
}
