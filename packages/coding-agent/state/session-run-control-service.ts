// Coordinates product-level control requests for existing session runs.
import type { SessionMessageCancelPayload } from '@megumi/shared/ipc';
import type { RuntimeContext, RuntimeEvent } from '@megumi/shared/runtime';
import type { ModelCallProvider } from '../agent-loop/model-call';
import type { ChatStreamEventAdapter } from '../projections/chat-stream';
import {
  ActiveSessionMessageRunTracker,
  type RunRetryCoordinatorPort,
  type RunTerminalCoordinatorPort,
} from './index';

export interface SessionRunControlServiceClock {
  now(): string;
}

export interface SessionRunControlServiceIds {
  cancelRequestId(): string;
}

export interface SessionRunControlServiceOptions {
  clock: SessionRunControlServiceClock;
  ids: SessionRunControlServiceIds;
  activeRuns: ActiveSessionMessageRunTracker<ChatStreamEventAdapter>;
  terminalCoordinator: RunTerminalCoordinatorPort;
  retryCoordinator: Pick<
    RunRetryCoordinatorPort,
    'createManualRetryFromRun' | 'createManualRerunFromUserMessage'
  >;
  modelCallProvider?: Pick<ModelCallProvider, 'cancelModelCall'>;
  cancelPendingApprovalGroupsByRun(runId: string): void;
  appendEvent(event: RuntimeEvent, projection?: ChatStreamEventAdapter): void;
}

export class SessionRunControlService {
  private readonly clock: SessionRunControlServiceClock;
  private readonly ids: SessionRunControlServiceIds;
  private readonly activeRuns: ActiveSessionMessageRunTracker<ChatStreamEventAdapter>;
  private readonly terminalCoordinator: RunTerminalCoordinatorPort;
  private readonly retryCoordinator: Pick<
    RunRetryCoordinatorPort,
    'createManualRetryFromRun' | 'createManualRerunFromUserMessage'
  >;
  private readonly modelCallProvider?: Pick<ModelCallProvider, 'cancelModelCall'>;
  private readonly cancelPendingApprovalGroupsByRun: (runId: string) => void;
  private readonly appendEvent: (event: RuntimeEvent, projection?: ChatStreamEventAdapter) => void;

  constructor(options: SessionRunControlServiceOptions) {
    this.clock = options.clock;
    this.ids = options.ids;
    this.activeRuns = options.activeRuns;
    this.terminalCoordinator = options.terminalCoordinator;
    this.retryCoordinator = options.retryCoordinator;
    this.modelCallProvider = options.modelCallProvider;
    this.cancelPendingApprovalGroupsByRun = options.cancelPendingApprovalGroupsByRun;
    this.appendEvent = options.appendEvent;
  }

  cancelSessionMessage(payload: SessionMessageCancelPayload): boolean {
    const providerCancelled = this.modelCallProvider?.cancelModelCall(payload.targetRequestId) ?? false;
    const activeRun = this.activeRuns.get(payload.targetRequestId);

    if (!activeRun) {
      return providerCancelled;
    }

    const result = this.terminalCoordinator.cancelActiveSessionMessageRun({
      activeRun,
      targetRequestId: payload.targetRequestId,
      cancelRequestId: this.ids.cancelRequestId(),
      cancelledAt: this.clock.now(),
      providerCancelled,
      cancelPendingApprovalGroupsByRun: (runId) => this.cancelPendingApprovalGroupsByRun(runId),
      appendEvent: (event) => this.appendEvent(event, activeRun.projection),
    });

    if (result.shouldForgetActiveRun) {
      this.activeRuns.forget(payload.targetRequestId);
    }
    return result.handled ? true : providerCancelled;
  }

  createManualRetryFromRun(input: {
    requestId: string;
    runId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): ReturnType<RunRetryCoordinatorPort['createManualRetryFromRun']> {
    return this.retryCoordinator.createManualRetryFromRun(input);
  }

  createManualRerunFromUserMessage(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): ReturnType<RunRetryCoordinatorPort['createManualRerunFromUserMessage']> {
    return this.retryCoordinator.createManualRerunFromUserMessage(input);
  }

  cleanupInterruptedRunsOnStartup(): ReturnType<RunTerminalCoordinatorPort['cleanupInterruptedRunsOnStartup']> {
    return this.terminalCoordinator.cleanupInterruptedRunsOnStartup({
      cleanupAt: this.clock.now(),
    });
  }
}
