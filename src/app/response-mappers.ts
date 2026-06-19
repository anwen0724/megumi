// Keeps App response mapping explicit even when the runtime already returns App-shaped data.
import type { AppRunControlResponse, AppRunResponse, AppStartRunResponse } from './responses';

export function mapAgentStartResult(result: AppStartRunResponse): AppStartRunResponse {
  return result;
}

export function mapAgentRunResult(result: AppRunResponse): AppRunResponse {
  return result;
}

export function mapAgentControlResult(result: AppRunControlResponse): AppRunControlResponse {
  return result;
}
