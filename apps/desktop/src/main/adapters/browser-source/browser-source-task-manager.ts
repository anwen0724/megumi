/* Owns the in-memory lifecycle of execution-bound browser source tasks. */
import {
  BrowserSourceTaskRequestSchema,
  BrowserSourceTaskResultSchema,
  type BrowserSourceId,
  type BrowserSourceTaskGateway,
  type BrowserSourceTaskRequest,
  type BrowserSourceTaskResult,
} from '@megumi/discovery';

export interface BrowserSourceClaim {
  readonly task: {
    readonly taskId: string;
    readonly deadlineAt: string;
    readonly request: BrowserSourceTaskRequest;
  };
  readonly claimToken: string;
}

interface TaskRecord {
  readonly taskId: string;
  readonly request: BrowserSourceTaskRequest;
  readonly deadlineAt: string;
  readonly resolve: (result: BrowserSourceTaskResult) => void;
  claimToken?: string;
  timeout: ReturnType<typeof setTimeout>;
  removeAbort: () => void;
}

export interface BrowserSourceTaskManager extends BrowserSourceTaskGateway {
  claim(sourceId: BrowserSourceId): BrowserSourceClaim | undefined;
  complete(taskId: string, claimToken: string, result: unknown): void;
  cancelAll(): void;
  subscribeTaskAvailable(listener: (sourceId: BrowserSourceId) => void): () => void;
}

export function createBrowserSourceTaskManager(input: {
  readonly createId: () => string;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly getConnectionState?: BrowserSourceTaskGateway['getConnectionState'];
}): BrowserSourceTaskManager {
  const timeoutMs = input.timeoutMs ?? 75_000;
  const now = input.now ?? Date.now;
  const tasks = new Map<string, TaskRecord>();
  const listeners = new Set<(sourceId: BrowserSourceId) => void>();

  const settle = (task: TaskRecord, result: BrowserSourceTaskResult): void => {
    if (!tasks.delete(task.taskId)) return;
    clearTimeout(task.timeout);
    task.removeAbort();
    task.resolve(result);
  };

  return {
    getConnectionState: input.getConnectionState ?? (() => ({ state: 'ready' })),
    execute(request, options) {
      const parsed = BrowserSourceTaskRequestSchema.parse(request);
      if (options.signal.aborted) return Promise.resolve(failed('cancelled', 'Browser source task was cancelled.'));
      return new Promise((resolve) => {
        const taskId = input.createId();
        const onAbort = () => {
          const task = tasks.get(taskId);
          if (task) settle(task, failed('cancelled', 'Browser source task was cancelled.'));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        const record: TaskRecord = {
          taskId,
          request: parsed,
          deadlineAt: new Date(now() + timeoutMs).toISOString(),
          resolve,
          timeout: setTimeout(() => {
            const task = tasks.get(taskId);
            if (task) settle(task, failed('timeout', 'Browser source task timed out.'));
          }, timeoutMs),
          removeAbort: () => options.signal.removeEventListener('abort', onAbort),
        };
        tasks.set(taskId, record);
        for (const listener of listeners) listener(parsed.sourceId);
      });
    },
    claim(sourceId) {
      if ([...tasks.values()].some((task) => task.request.sourceId === sourceId && task.claimToken)) return undefined;
      const task = [...tasks.values()].find((item) => item.request.sourceId === sourceId && !item.claimToken);
      if (!task) return undefined;
      task.claimToken = input.createId();
      return {
        task: { taskId: task.taskId, deadlineAt: task.deadlineAt, request: task.request },
        claimToken: task.claimToken,
      };
    },
    complete(taskId, claimToken, inputResult) {
      const task = tasks.get(taskId);
      if (!task) throw new Error('Browser source task was not found or was cancelled.');
      if (!task.claimToken || task.claimToken !== claimToken) throw new Error('Browser source claim token is invalid.');
      settle(task, BrowserSourceTaskResultSchema.parse(inputResult));
    },
    cancelAll() {
      for (const task of [...tasks.values()]) settle(task, failed('cancelled', 'Browser source task was cancelled.'));
    },
    subscribeTaskAvailable(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function failed(code: 'cancelled' | 'timeout', message: string): BrowserSourceTaskResult {
  return { status: 'failed', failure: { code, message } };
}
