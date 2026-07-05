/*
 * Defines Context Usage Monitor contracts and per-session usage signals.
 */
import type { RuntimeError } from './context-contracts';

export type ContextUsageWindow = {
  model_id: string;
  context_window_tokens: number;
};

export type SessionContextUsage = {
  used_tokens: number;
  context_window_tokens: number;
  remaining_tokens: number;
  used_ratio: number;
  auto_compaction_threshold_ratio: number;
  should_auto_compact: boolean;
};

export type StartContextUsageMonitorRequest = {
  session_id: string;
  workspace_id?: string;
  model_config: ContextUsageWindow;
  threshold_ratio?: number;
};

export type StartContextUsageMonitorResult =
  | { status: 'ok' }
  | { status: 'failed'; failure: RuntimeError };

export type StopContextUsageMonitorRequest = {
  session_id: string;
  workspace_id?: string;
};

export type StopContextUsageMonitorResult =
  | { status: 'ok' }
  | { status: 'not_started' }
  | { status: 'failed'; failure: RuntimeError };

export type GetCurrentContextUsageRequest = {
  session_id: string;
  workspace_id?: string;
};

export type GetCurrentContextUsageResult =
  | { status: 'ok'; usage: SessionContextUsage }
  | { status: 'not_available'; reason: 'not_started' | 'not_calculated' }
  | { status: 'failed'; failure: RuntimeError };

export type ContextUsageSignal =
  | {
      kind: 'usage_changed';
      signal_id: string;
      session_id: string;
      workspace_id?: string;
      usage: SessionContextUsage;
      created_at: string;
    }
  | {
      kind: 'auto_compaction_needed';
      signal_id: string;
      session_id: string;
      workspace_id?: string;
      usage: SessionContextUsage;
      created_at: string;
    };

export type SubscribeContextUsageRequest = {
  session_id: string;
  workspace_id?: string;
  signal_kinds?: ContextUsageSignal['kind'][];
};

export type SubscribeContextUsageResult =
  | { status: 'ok'; subscription_id: string }
  | { status: 'failed'; failure: RuntimeError };

export type UnsubscribeContextUsageRequest = {
  subscription_id: string;
};

export type UnsubscribeContextUsageResult =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'failed'; failure: RuntimeError };
