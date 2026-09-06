/* Captures actual model cost and resolved Context checkpoints for each sequence operation. */
import type { ProductRuntime } from '@megumi/composition';
import type { SequenceTrace } from '../contracts/preference-sequence-record';

/** Reads every learning/recommendation Trace and rejects incomplete pagination. */
export async function sequenceTraceIds(runtime: ProductRuntime): Promise<string[]> {
  await runtime.host.observability.flush();
  const ids: string[] = [];
  for (let offset = 0; ; offset += 200) {
    const result = await runtime.host.observability.listTraces({ offset, limit: 200 });
    if (result.status !== 'ok') throw new Error(result.message);
    for (const trace of result.traces) {
      if (trace.traceKind !== 'preference_learning' && trace.traceKind !== 'recommendation') continue;
      if (ids.includes(trace.traceId)) throw new Error('Trace pagination repeated an ID.');
      ids.push(trace.traceId);
    }
    if (result.traces.length < 200) return ids;
  }
}

/** Retains missing bodies and measurements as issues, never as zero cost or empty valid input. */
export async function captureSequenceTraces(runtime: ProductRuntime, previous: readonly string[]): Promise<SequenceTrace[]> {
  const traces: SequenceTrace[] = [];
  for (const traceId of (await sequenceTraceIds(runtime)).filter((id) => !previous.includes(id))) {
    const detail = await runtime.host.observability.getTrace({ traceId });
    if (detail.status !== 'found') throw new Error(`Cannot capture Trace ${traceId}.`);
    const kind = detail.trace.summary.traceKind;
    if (kind !== 'preference_learning' && kind !== 'recommendation') continue;
    const measured = await runtime.host.observability.getTraceMeasurements({ traceId });
    const contexts: unknown[] = [];
    const issues: string[] = [];
    if (detail.trace.summary.diagnostics !== 'complete') issues.push(`Trace diagnostics incomplete: ${JSON.stringify(detail.trace.issues)}`);
    if (measured.status !== 'found') issues.push('Model measurements unavailable.');
    for (const checkpoint of detail.trace.contents.filter((entry) => entry.kind === 'context.resolved')) {
      const content = await runtime.host.observability.getContent({ traceId, sequence: checkpoint.sequence });
      if (content.status !== 'available' || content.content.encoding !== 'json') { issues.push('Resolved Context unavailable.'); continue; }
      const value: unknown = JSON.parse(content.content.json);
      contexts.push(value);
    }
    traces.push({ traceId, kind, measurements: measured.status === 'found' ? measured.measurements : null, contexts, issues });
  }
  return traces;
}
