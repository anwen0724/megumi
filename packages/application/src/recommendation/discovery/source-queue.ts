/*
 * Shares bounded source/model slots; queued daily work gets the next free slot.
 */
import { abortable } from '../sources/source-http';
export function createSourceQueue(capacity: () => number) {
  const waiting: {
    priority: number;
    signal: AbortSignal;
    start(): void;
    reject(reason: unknown): void;
    abort(): void;
  }[] = [];
  let active = 0;
  const executing = new Set<Promise<unknown>>();
  function dispatch() {
    while (active < capacity() && waiting.length) {
      waiting.sort((a, b) => b.priority - a.priority);
      const entry = waiting.shift()!;
      entry.signal.removeEventListener('abort', entry.abort);
      if (entry.signal.aborted) {
        entry.reject(entry.signal.reason);
        continue;
      }
      active++;
      entry.start();
    }
  }
  return {
    run<T>(operation: () => Promise<T>, signal: AbortSignal, priority = 0): Promise<T> {
      if (signal.aborted)
        return Promise.reject(signal.reason);
      return new Promise<T>((resolve, reject) => {
        const entry = {
          priority, signal, reject,
          start() {
            const task = Promise.resolve().then(operation);
            executing.add(task);
            void task.finally(() => { executing.delete(task); active--; dispatch(); }).catch(() => undefined);
            void abortable(task, signal).then(resolve, reject);
          },
          abort() {
            const index = waiting.indexOf(entry); if (index >= 0)
              waiting.splice(index, 1); reject(signal.reason);
          },
        };
        signal.addEventListener('abort', entry.abort, { once: true });
        waiting.push(entry);
        dispatch();
      });
    },
    /** Waits for actual I/O, including operations whose caller has already cancelled. */
    async drain(signal: AbortSignal): Promise<void> {
      await abortable(Promise.allSettled([...executing]), signal);
    },
  };
}
export type SourceQueue = ReturnType<typeof createSourceQueue>;
