import type { IsoDateTime, RunEventId, RunId, SessionId } from '../primitives/ids';
import type { ModelId } from '../model/contracts';
import type { ProviderId } from '../provider/contracts';
import type { RuntimeError } from '../runtime/errors';
import type { RuntimeEvent } from '../runtime/events';

export const RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export type RunKind = 'chat' | 'agent';

export interface RunRecord {
  id: RunId | string;
  sessionId: SessionId | string;
  status: RunStatus;
  providerId: ProviderId;
  modelId: ModelId | string;
  kind?: RunKind;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  error?: RuntimeError;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface RunEventRecord {
  id: RunEventId | string;
  runId: RunId | string;
  sequence: number;
  event: RuntimeEvent;
  createdAt: IsoDateTime;
}

