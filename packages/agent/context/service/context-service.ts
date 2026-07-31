/*
 * Defines ContextService as the Context module's single public business interface.
 */
import type {
  CompactSessionRequest,
  CompactSessionResult,
  GetSessionUsageSnapshotRequest,
  GetSessionUsageSnapshotResult,
  BuildContextRequest,
  BuildContextResult,
  RecordCompletedRunUsageRequest,
  RecordCompletedRunUsageResult,
} from './context-service-types';

export interface ContextService {
  build(request: BuildContextRequest): Promise<BuildContextResult>;
  compactSession(request: CompactSessionRequest): Promise<CompactSessionResult>;
  recordCompletedRunUsage(request: RecordCompletedRunUsageRequest): RecordCompletedRunUsageResult;
  getSessionUsageSnapshot(request: GetSessionUsageSnapshotRequest): GetSessionUsageSnapshotResult;
}
