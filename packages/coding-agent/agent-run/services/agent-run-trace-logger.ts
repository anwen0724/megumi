/*
 * Agent Run trace logger implementations.
 * The file logger writes development-time JSONL diagnostics without affecting run execution.
 */
import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  AgentRunTraceLogger,
  AgentRunTraceRecord,
  AgentRunTraceRecordInput,
} from '../contracts/agent-run-trace-contracts';

export type CreateAgentRunTraceFileLoggerOptions = {
  log_file_path: string;
  clock?: { now(): string };
  on_error?: (error: unknown) => void;
};

const REDACTED = '[REDACTED]';
const TRUNCATED = '...[TRUNCATED]';
const MAX_STRING_LENGTH = 4000;
const MAX_PAYLOAD_JSON_LENGTH = 12000;
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|apikey|authorization|token|secret|password|credential|cookie|private[_-]?key)/i;

export function createNoopAgentRunTraceLogger(): AgentRunTraceLogger {
  return {
    record() {
      // no-op by design
    },
  };
}

export function createAgentRunTraceFileLogger(
  options: CreateAgentRunTraceFileLoggerOptions,
): AgentRunTraceLogger {
  const logger = new AgentRunTraceFileLogger(options);
  return {
    record(record) {
      logger.record(record);
    },
  };
}

class AgentRunTraceFileLogger {
  private readonly sequenceByTraceId = new Map<string, number>();
  private readonly clock: Required<NonNullable<CreateAgentRunTraceFileLoggerOptions['clock']>>;
  private ensureDirectoryPromise: Promise<void> | undefined;

  constructor(private readonly options: CreateAgentRunTraceFileLoggerOptions) {
    this.clock = {
      now: options.clock?.now ?? (() => new Date().toISOString()),
    };
  }

  record(input: AgentRunTraceRecordInput): void {
    const record = this.createRecord(input);
    void this.writeRecord(record).catch((error) => {
      this.options.on_error?.(error);
    });
  }

  private createRecord(input: AgentRunTraceRecordInput): AgentRunTraceRecord {
    const sequence = (this.sequenceByTraceId.get(input.trace_id) ?? 0) + 1;
    this.sequenceByTraceId.set(input.trace_id, sequence);

    return {
      schema_version: 1,
      timestamp: input.timestamp ?? this.clock.now(),
      trace_id: input.trace_id,
      sequence,
      event_type: input.event_type,
      ...(input.run_id ? { run_id: input.run_id } : {}),
      ...(input.session_id ? { session_id: input.session_id } : {}),
      ...(input.workspace_id ? { workspace_id: input.workspace_id } : {}),
      ...(input.model_call_id ? { model_call_id: input.model_call_id } : {}),
      ...(input.tool_call_id ? { tool_call_id: input.tool_call_id } : {}),
      payload: normalizePayload(input.payload),
    };
  }

  private async writeRecord(record: AgentRunTraceRecord): Promise<void> {
    await this.ensureDirectory();
    await appendFile(this.options.log_file_path, `${JSON.stringify(record)}\n`, 'utf8');
  }

  private ensureDirectory(): Promise<void> {
    if (!this.ensureDirectoryPromise) {
      this.ensureDirectoryPromise = mkdir(dirname(this.options.log_file_path), { recursive: true }).then(() => undefined);
    }
    return this.ensureDirectoryPromise;
  }
}

function normalizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactValue(payload) as Record<string, unknown>;
  const serialized = JSON.stringify(redacted);
  if (serialized.length <= MAX_PAYLOAD_JSON_LENGTH) {
    return redacted;
  }

  return {
    truncated: true,
    preview: truncateString(serialized, MAX_PAYLOAD_JSON_LENGTH),
  };
}

function redactValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED;
  }

  if (typeof value === 'string') {
    return truncateString(value, MAX_STRING_LENGTH);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}${TRUNCATED}`;
}
