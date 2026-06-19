// Defines the cross-entry App API consumed by desktop, future web, CLI, and tests.
import type { AppClientContext } from './client-context';
import type {
  AppCancelRunRequest,
  AppResumeRunRequest,
  AppRetryRunRequest,
  AppStartRunRequest,
} from './requests';
import type { AppRunControlResponse, AppRunResponse, AppStartRunResponse } from './responses';

export interface AppApi {
  startRun(request: AppStartRunRequest, context: AppClientContext): Promise<AppStartRunResponse>;
  resumeRun(request: AppResumeRunRequest, context: AppClientContext): Promise<AppRunResponse>;
  cancelRun(request: AppCancelRunRequest, context: AppClientContext): Promise<AppRunControlResponse>;
  retryRun(request: AppRetryRunRequest, context: AppClientContext): Promise<AppRunControlResponse>;
}
