/* Projects raw diagnostic records into run-oriented UI summaries and details. */
import type { ObservabilityRecord } from "../../domain/model/observability-record";
import type {
  RunTraceDetail,
  RunTraceSummary,
} from "../../domain/dto/ui/observability-ui-response";
export function projectRunTrace(
  traceId: string,
  records: ObservabilityRecord[],
  dropped = 0,
): RunTraceDetail | undefined {
  const traceRecords = records
    .filter((r) => r.correlation.traceId === traceId)
    .sort((a, b) => a.sequence - b.sequence);
  const started = traceRecords.find((r) => r.type === "trace.started");
  if (!started?.correlation.runId) return undefined;
  const ended = [...traceRecords]
    .reverse()
    .find((r) => r.type === "trace.ended");
  const models = traceRecords.filter(
    (r) => r.type === "span.started" && r.name === "model.call",
  );
  const tools = traceRecords.filter(
    (r) => r.type === "span.started" && r.name === "tool.call",
  );
  const summary: RunTraceSummary = {
    traceId,
    runId: started.correlation.runId,
    sessionId: started.correlation.sessionId,
    workspaceId: started.correlation.workspaceId,
    status: ended?.type === "trace.ended" ? ended.status : "incomplete",
    startedAt: started.timestamp,
    ...(ended?.type === "trace.ended"
      ? { endedAt: ended.timestamp, durationMs: ended.durationMs }
      : {}),
    modelCallCount: models.length,
    toolCallCount: tools.length,
  };
  const attrs = models.at(-1)?.attributes;
  if (typeof attrs?.providerId === "string")
    summary.providerId = attrs.providerId;
  if (typeof attrs?.modelId === "string") summary.modelId = attrs.modelId;
  const input = sum(traceRecords, "model.input_tokens");
  const output = sum(traceRecords, "model.output_tokens");
  if (input !== undefined) summary.inputTokens = input;
  if (output !== undefined) summary.outputTokens = output;
  const spanEnds = new Map(
    traceRecords.flatMap((record) =>
      record.type === "span.ended"
        ? [[record.correlation.spanId, record] as const]
        : [],
    ),
  );
  const spans = traceRecords.flatMap((record) => {
    if (record.type !== "span.started" || !record.correlation.spanId) return [];
    const endedSpan = spanEnds.get(record.correlation.spanId);
    return [
      {
        spanId: record.correlation.spanId,
        parentSpanId: record.correlation.parentSpanId,
        name: record.name,
        status: endedSpan?.status ?? ("incomplete" as const),
        startedAt: record.timestamp,
        ...(endedSpan
          ? { endedAt: endedSpan.timestamp, durationMs: endedSpan.durationMs }
          : {}),
        attributes: record.attributes,
      },
    ];
  });
  const logs = traceRecords.flatMap((record) =>
    record.type === "log"
      ? [
          {
            timestamp: record.timestamp,
            level: record.level,
            event: record.event,
            attributes: record.attributes,
          },
        ]
      : [],
  );
  const measurements = traceRecords.flatMap((record) =>
    record.type === "measurement"
      ? [
          {
            timestamp: record.timestamp,
            name: record.name,
            value: record.value,
            unit: record.unit,
            attributes: record.attributes,
          },
        ]
      : [],
  );
  return { summary, spans, logs, measurements, droppedRecordCount: dropped };
}
function sum(records: ObservabilityRecord[], name: string): number | undefined {
  const values = records.flatMap((r) =>
    r.type === "measurement" && r.name === name ? [r.value] : [],
  );
  return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
}
