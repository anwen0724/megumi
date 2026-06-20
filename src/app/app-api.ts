// Defines the cross-entry App API consumed by desktop, future web, CLI, and tests.
import type { AppEntryContext } from './entry-context';
import type {
  AppCancelRunRequest,
  AppResumeRunRequest,
  AppRetryRunRequest,
  AppStartRunRequest,
} from './requests';
import type { AppRunControlResponse, AppRunResponse, AppStartRunResponse } from './responses';

export interface AppApi {
  startRun(request: AppStartRunRequest, context: AppEntryContext): Promise<AppStartRunResponse>;
  resumeRun(request: AppResumeRunRequest, context: AppEntryContext): Promise<AppRunResponse>;
  cancelRun(request: AppCancelRunRequest, context: AppEntryContext): Promise<AppRunControlResponse>;
  retryRun(request: AppRetryRunRequest, context: AppEntryContext): Promise<AppRunControlResponse>;
}
