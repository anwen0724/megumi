// Defines the entrypoint-neutral event surface exposed by AppApi.subscribe().
export type AppEventSource = 'agent';

export interface AppEvent {
  type: string;
  occurredAt: string;
  source: AppEventSource;
  payload: Record<string, unknown>;
}

export type AppEventSubscriber = (event: AppEvent) => void;
