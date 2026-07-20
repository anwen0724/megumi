/* Collects bounded Session, workspace, Runtime Event, and diagnostic evidence. */
import path from 'node:path';
import type { ProductHostInterface } from '@megumi/product/host-interface';
import type { RuntimeEvent } from '@megumi/product/runtime-events';
import type { EvaluationEvidence, EvaluationWorkspaceFileEvidence } from './evaluation-contracts';
import { digestOwnedFile, readBoundedOwnedText } from '../adapters/scoped-workspace-file-system';

export async function collectEvaluationEvidence(input: {
  workspaceRoot: string;
  declaredWorkspacePaths: string[];
  maximumFileBytes?: number;
  maximumTotalBytes?: number;
  sessionId: string;
  messages: unknown[];
  timeline: unknown[];
  runtimeEvents: RuntimeEvent[];
  runtimeEventsComplete: boolean;
  runtimeEventsTruncated?: boolean;
  runId?: string;
  observabilityHost?: Pick<ProductHostInterface['observability'], 'getRunTrace'>;
  initialWorkspaceFiles?: Record<string, { exists: boolean; content?: string; digest?: string }>;
}): Promise<EvaluationEvidence> {
  const maximumFileBytes = input.maximumFileBytes ?? 64 * 1024;
  const maximumTotalBytes = input.maximumTotalBytes ?? 256 * 1024;
  let remainingBytes = maximumTotalBytes;
  const files: EvaluationWorkspaceFileEvidence[] = [];
  let workspaceComplete = true;

  for (const relativePath of [...new Set(input.declaredWorkspacePaths)]) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) {
      files.push({ path: relativePath, exists: false, error: 'Path is outside the Evaluation workspace.' });
      workspaceComplete = false;
      continue;
    }
    try {
      const allowedBytes = Math.max(0, Math.min(maximumFileBytes, remainingBytes));
      const read = await readBoundedOwnedText(input.workspaceRoot, normalized, allowedBytes);
      const digest = await digestOwnedFile(input.workspaceRoot, normalized);
      const content = read.content;
      const truncated = read.truncated;
      files.push({
        path: normalized,
        exists: true,
        content,
        digest,
        ...(input.initialWorkspaceFiles && Object.prototype.hasOwnProperty.call(input.initialWorkspaceFiles, normalized)
          ? {
              initialContent: input.initialWorkspaceFiles[normalized]?.content,
              initialExists: input.initialWorkspaceFiles[normalized]?.exists,
              initialDigest: input.initialWorkspaceFiles[normalized]?.digest,
            }
          : {}),
        ...(truncated ? { truncated: true } : {}),
      });
      remainingBytes -= Math.min(read.sizeBytes, allowedBytes);
      if (truncated) workspaceComplete = false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        files.push({
          path: normalized,
          exists: false,
          ...(input.initialWorkspaceFiles && Object.prototype.hasOwnProperty.call(input.initialWorkspaceFiles, normalized)
            ? {
                initialContent: input.initialWorkspaceFiles[normalized]?.content,
                initialExists: input.initialWorkspaceFiles[normalized]?.exists,
                initialDigest: input.initialWorkspaceFiles[normalized]?.digest,
              }
            : {}),
        });
      } else {
        files.push({ path: normalized, exists: false, error: errorMessage(error) });
        workspaceComplete = false;
      }
    }
  }

  const assistantMessages = input.messages.filter(isAssistantMessage);
  const finalReply = assistantMessages.at(-1)?.text;
  const diagnostics = await collectDiagnostics(input.observabilityHost, input.runId);

  return {
    session: {
      sessionId: input.sessionId,
      messages: input.messages,
      timeline: input.timeline,
      ...(finalReply ? { finalReply } : {}),
      complete: true,
    },
    workspace: { files, complete: workspaceComplete },
    runtimeEvents: {
      events: input.runtimeEvents,
      complete: input.runtimeEventsComplete && !input.runtimeEventsTruncated,
      truncated: Boolean(input.runtimeEventsTruncated),
    },
    ...(diagnostics ? { diagnostics } : {}),
  };
}

async function collectDiagnostics(
  host: Pick<ProductHostInterface['observability'], 'getRunTrace'> | undefined,
  runId: string | undefined,
): Promise<EvaluationEvidence['diagnostics'] | undefined> {
  if (!host || !runId) return undefined;
  try {
    const result = await host.getRunTrace({ runId });
    return result.status === 'found'
      ? { available: true, records: [{
          summary: result.trace.summary,
          spans: result.trace.spans.slice(0, 200).map((span) => ({ name: span.name, status: span.status, durationMs: span.durationMs })),
          logs: result.trace.logs.slice(0, 200).map((log) => ({ timestamp: log.timestamp, level: log.level, event: log.event })),
          measurements: result.trace.measurements.slice(0, 200).map((measurement) => ({ name: measurement.name, value: measurement.value, unit: measurement.unit })),
          droppedRecordCount: result.trace.droppedRecordCount,
          truncated: result.trace.spans.length > 200 || result.trace.logs.length > 200 || result.trace.measurements.length > 200,
        }] }
      : { available: false, error: `Run trace is ${result.status}.` };
  } catch (error) {
    return { available: false, error: errorMessage(error) };
  }
}

function normalizeRelativePath(value: string): string | undefined {
  if (!value || path.isAbsolute(value)) return undefined;
  const normalized = path.normalize(value);
  return normalized === '..' || normalized.startsWith(`..${path.sep}`) ? undefined : normalized.replace(/\\/g, '/');
}

function isAssistantMessage(value: unknown): value is { role: 'assistant'; text: string } {
  return Boolean(value && typeof value === 'object'
    && (value as { role?: unknown }).role === 'assistant'
    && typeof (value as { text?: unknown }).text === 'string');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
