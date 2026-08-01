/* Builds an explicit, bounded and already-sanitized local diagnostic bundle. */
import type { RunTraceDetail } from "../../domain/dto/ui/observability-ui-response";
import type {
  DiagnosticBundle,
  DiagnosticEnvironment,
} from "../../domain/model/diagnostic-bundle";
export function buildDiagnosticBundle(
  detail: RunTraceDetail,
  environment: DiagnosticEnvironment,
  now: Date,
): DiagnosticBundle {
  const id = detail.summary.runId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return {
    suggestedDirectoryName: `megumi-diagnostic-${id}`,
    files: [
      {
        relativePath: "manifest.json",
        content: JSON.stringify(
          {
            schemaVersion: 1,
            createdAt: now.toISOString(),
            run: detail.summary,
          },
          null,
          2,
        ),
      },
      {
        relativePath: "run-traces.jsonl",
        content: `${JSON.stringify(detail)}\n`,
      },
      {
        relativePath: "environment.json",
        content: JSON.stringify(environment, null, 2),
      },
    ],
  };
}
