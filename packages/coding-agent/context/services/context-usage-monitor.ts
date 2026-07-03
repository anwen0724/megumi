/*
 * Provides the public Context Usage Monitor entrypoint for per-session context window usage.
 */
import { evaluateSessionContextUsage } from '../core/session-context-usage';
import type {
  ContextUsageSignal,
  GetCurrentContextUsageRequest,
  GetCurrentContextUsageResult,
  ModelConfig,
  SessionContextUsage,
  StartContextUsageMonitorRequest,
  StartContextUsageMonitorResult,
  StopContextUsageMonitorRequest,
  StopContextUsageMonitorResult,
  SubscribeContextUsageRequest,
  SubscribeContextUsageResult,
  UnsubscribeContextUsageRequest,
  UnsubscribeContextUsageResult,
} from '../contracts/context-usage-contracts';
import type { ContextService } from './context-service';

type SessionMonitorState = {
  session_id: string;
  workspace_id?: string;
  model_config: ModelConfig;
  threshold_ratio: number;
  usage?: SessionContextUsage;
  last_auto_signal_key?: string;
  compaction_running: boolean;
};

type Subscription = {
  subscription_id: string;
  session_key: string;
  signal_kinds?: ContextUsageSignal['kind'][];
};

export class ContextUsageMonitor {
  private readonly sessions = new Map<string, SessionMonitorState>();
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(private readonly options: {
    contextService: Pick<ContextService, 'getSessionContext'>;
    clock?: { now(): string };
    ids?: { signalId(): string; subscriptionId(): string };
    defaultThresholdRatio?: number;
    fixedPromptText?: string;
    signalSink?: (input: { subscription_id: string; signal: ContextUsageSignal }) => void | Promise<void>;
  }) {}

  async start(request: StartContextUsageMonitorRequest): Promise<StartContextUsageMonitorResult> {
    this.sessions.set(sessionKey(request), {
      session_id: request.session_id,
      ...(request.workspace_id ? { workspace_id: request.workspace_id } : {}),
      model_config: request.model_config,
      threshold_ratio: request.threshold_ratio ?? this.options.defaultThresholdRatio ?? 0.8,
      compaction_running: false,
    });
    return { status: 'ok' };
  }

  stop(request: StopContextUsageMonitorRequest): StopContextUsageMonitorResult {
    const key = sessionKey(request);
    if (!this.sessions.has(key)) {
      return { status: 'not_started' };
    }
    this.sessions.delete(key);
    for (const [subscriptionId, subscription] of this.subscriptions) {
      if (subscription.session_key === key) {
        this.subscriptions.delete(subscriptionId);
      }
    }
    return { status: 'ok' };
  }

  getCurrentUsage(request: GetCurrentContextUsageRequest): GetCurrentContextUsageResult {
    const state = this.sessions.get(sessionKey(request));
    if (!state) {
      return { status: 'not_available', reason: 'not_started' };
    }
    if (!state.usage) {
      return { status: 'not_available', reason: 'not_calculated' };
    }
    return { status: 'ok', usage: state.usage };
  }

  subscribe(request: SubscribeContextUsageRequest): SubscribeContextUsageResult {
    const subscriptionId = this.options.ids?.subscriptionId() ?? `context-usage-subscription:${Date.now()}`;
    this.subscriptions.set(subscriptionId, {
      subscription_id: subscriptionId,
      session_key: sessionKey(request),
      signal_kinds: request.signal_kinds,
    });
    return { status: 'ok', subscription_id: subscriptionId };
  }

  unsubscribe(request: UnsubscribeContextUsageRequest): UnsubscribeContextUsageResult {
    if (!this.subscriptions.delete(request.subscription_id)) {
      return { status: 'not_found' };
    }
    return { status: 'ok' };
  }

  async refreshSession(input: { session_id: string; workspace_id?: string; reason: string }): Promise<void> {
    const key = sessionKey(input);
    const state = this.sessions.get(key);
    if (!state) {
      return;
    }

    const contextResult = await this.options.contextService.getSessionContext({
      session_id: input.session_id,
      workspace_id: input.workspace_id,
      purpose: 'agent_response',
    });
    if (contextResult.status !== 'ok') {
      return;
    }

    const nextUsage = evaluateSessionContextUsage({
      session_context: contextResult.session_context,
      model_config: state.model_config,
      threshold_ratio: state.threshold_ratio,
      fixed_prompt_text: this.options.fixedPromptText,
    });
    const previousUsage = state.usage;
    state.usage = nextUsage;

    if (!previousUsage || usageKey(previousUsage) !== usageKey(nextUsage)) {
      await this.emitSignal(key, {
        kind: 'usage_changed',
        signal_id: this.signalId(),
        session_id: input.session_id,
        ...(input.workspace_id ? { workspace_id: input.workspace_id } : {}),
        usage: nextUsage,
        created_at: this.now(),
      });
    }

    const autoSignalKey = usageKey(nextUsage);
    if (nextUsage.should_auto_compact
      && !state.compaction_running
      && state.last_auto_signal_key !== autoSignalKey) {
      state.last_auto_signal_key = autoSignalKey;
      await this.emitSignal(key, {
        kind: 'auto_compaction_needed',
        signal_id: this.signalId(),
        session_id: input.session_id,
        ...(input.workspace_id ? { workspace_id: input.workspace_id } : {}),
        usage: nextUsage,
        created_at: this.now(),
      });
    }
  }

  markCompactionRunning(input: { session_id: string; workspace_id?: string; running: boolean }): void {
    const state = this.sessions.get(sessionKey(input));
    if (state) {
      state.compaction_running = input.running;
    }
  }

  private async emitSignal(sessionKeyValue: string, signal: ContextUsageSignal): Promise<void> {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.session_key !== sessionKeyValue) {
        continue;
      }
      if (subscription.signal_kinds && !subscription.signal_kinds.includes(signal.kind)) {
        continue;
      }
      await this.options.signalSink?.({
        subscription_id: subscription.subscription_id,
        signal,
      });
    }
  }

  private signalId(): string {
    return this.options.ids?.signalId() ?? `context-usage-signal:${Date.now()}`;
  }

  private now(): string {
    return this.options.clock?.now() ?? new Date().toISOString();
  }
}

function sessionKey(input: { session_id: string; workspace_id?: string }): string {
  return `${input.workspace_id ?? ''}::${input.session_id}`;
}

function usageKey(usage: SessionContextUsage): string {
  return [
    usage.used_tokens,
    usage.context_window_tokens,
    usage.remaining_tokens,
    usage.used_ratio,
    usage.auto_compaction_threshold_ratio,
    usage.should_auto_compact,
  ].join(':');
}
