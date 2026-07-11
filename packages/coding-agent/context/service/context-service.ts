/*
 * Defines ContextService as the Context module's single public business interface.
 */
import type {
  CompactSessionRequest,
  CompactSessionResult,
  GetSessionUsageSnapshotRequest,
  GetSessionUsageSnapshotResult,
  PrepareModelCallRequest,
  PrepareModelCallResult,
  RecordCompletedRunUsageRequest,
  RecordCompletedRunUsageResult,
} from './context-service-types';

export interface ContextService {
  prepareModelCall(request: PrepareModelCallRequest): Promise<PrepareModelCallResult>;
  compactSession(request: CompactSessionRequest): Promise<CompactSessionResult>;
  recordCompletedRunUsage(request: RecordCompletedRunUsageRequest): RecordCompletedRunUsageResult;
  getSessionUsageSnapshot(request: GetSessionUsageSnapshotRequest): GetSessionUsageSnapshotResult;
}
