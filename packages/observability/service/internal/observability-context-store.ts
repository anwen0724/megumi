/* Propagates diagnostic correlation across async work, including parallel Tool Calls. */
import { AsyncLocalStorage } from "node:async_hooks";
import type { TraceContext } from "../../domain/model/trace";

export class ObservabilityContextStore {
  private readonly storage = new AsyncLocalStorage<TraceContext>();
  getCurrent(): TraceContext | undefined {
    return this.storage.getStore();
  }
  run<T>(context: TraceContext, operation: () => T): T {
    return this.storage.run(context, operation);
  }
}
