/* Keeps disk work off instrumentation call stacks and bounds diagnostic memory usage. */
import type { ObservabilityRecord } from "../../domain/model/observability-record";
import type { ObservabilityRecordSink } from "../observability-service-impl";
export class ObservabilityRecordBuffer implements ObservabilityRecordSink {
  private readonly queue: ObservabilityRecord[] = [];
  private drainPromise?: Promise<void>;
  private dropped = 0;
  constructor(
    private readonly writer: {
      append(records: readonly ObservabilityRecord[]): Promise<void>;
    },
    private readonly maxRecords = 5000,
  ) {}
  enqueue(record: ObservabilityRecord): void {
    if (this.queue.length >= this.maxRecords) {
      this.dropped++;
      return;
    }
    this.queue.push(record);
    this.schedule();
  }
  getDroppedRecordCount(): number {
    return this.dropped;
  }
  async flush(): Promise<void> {
    while (this.queue.length || this.drainPromise) {
      this.schedule();
      await this.drainPromise;
    }
  }
  private schedule(): void {
    if (this.drainPromise || !this.queue.length) return;
    const batch = this.queue.splice(0, this.queue.length);
    this.drainPromise = Promise.resolve()
      .then(() => this.writer.append(batch))
      .catch(() => {
        this.dropped += batch.length;
      })
      .finally(() => {
        this.drainPromise = undefined;
        if (this.queue.length) this.schedule();
      });
  }
}
