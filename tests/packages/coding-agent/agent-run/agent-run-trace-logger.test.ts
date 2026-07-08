import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgentRunTraceFileLogger,
  createNoopAgentRunTraceLogger,
  type AgentRunTraceRecord,
} from '@megumi/coding-agent/agent-run';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('Agent Run trace logger', () => {
  it('writes redacted JSONL records with per-trace sequence numbers', async () => {
    const directory = await createTempDirectory();
    const logPath = join(directory, 'logs', 'agent-run-trace.jsonl');
    const logger = createAgentRunTraceFileLogger({
      log_file_path: logPath,
      clock: { now: () => '2026-07-08T00:00:00.000Z' },
    });

    logger.record({
      trace_id: 'run-1',
      event_type: 'run.started',
      run_id: 'run-1',
      payload: {
        api_key: 'secret-key',
        nested: { authorization: 'Bearer token' },
      },
    });
    logger.record({
      trace_id: 'run-1',
      event_type: 'trace.loop.counters',
      run_id: 'run-1',
      payload: { model_calls: 1 },
    });
    logger.record({
      trace_id: 'run-2',
      event_type: 'run.started',
      run_id: 'run-2',
      payload: { token: 'secret-token' },
    });

    const records = await readRecords(logPath, 3);
    expect(records.map((record) => [record.trace_id, record.sequence])).toEqual([
      ['run-1', 1],
      ['run-1', 2],
      ['run-2', 1],
    ]);
    expect(records[0]).toEqual(expect.objectContaining({
      schema_version: 1,
      timestamp: '2026-07-08T00:00:00.000Z',
      event_type: 'run.started',
    }));
    expect(records[0]?.payload).toEqual({
      api_key: '[REDACTED]',
      nested: { authorization: '[REDACTED]' },
    });
    expect(records[2]?.payload).toEqual({ token: '[REDACTED]' });
  });

  it('truncates long strings before writing payloads', async () => {
    const directory = await createTempDirectory();
    const logPath = join(directory, 'agent-run-trace.jsonl');
    const logger = createAgentRunTraceFileLogger({ log_file_path: logPath });

    logger.record({
      trace_id: 'run-1',
      event_type: 'trace.prompt.built',
      payload: { prompt: 'x'.repeat(4100) },
    });

    const [record] = await readRecords(logPath, 1);
    expect(String(record?.payload.prompt)).toHaveLength(4014);
    expect(String(record?.payload.prompt)).toContain('...[TRUNCATED]');
  });

  it('does not throw when using no-op logger or when file writes fail', async () => {
    expect(() => createNoopAgentRunTraceLogger().record({
      trace_id: 'run-1',
      event_type: 'run.started',
      payload: {},
    })).not.toThrow();

    const onError = vi.fn();
    const logger = createAgentRunTraceFileLogger({
      log_file_path: '\0',
      on_error: onError,
    });

    expect(() => logger.record({
      trace_id: 'run-1',
      event_type: 'run.started',
      payload: {},
    })).not.toThrow();
    await waitFor(() => onError.mock.calls.length > 0);
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'megumi-agent-run-trace-'));
  tempDirectories.push(directory);
  return directory;
}

async function readRecords(filePath: string, expectedCount: number): Promise<AgentRunTraceRecord[]> {
  await waitFor(() => existsSync(filePath));
  await waitFor(async () => (await readLines(filePath)).length >= expectedCount);
  return (await readLines(filePath)).map((line) => JSON.parse(line) as AgentRunTraceRecord);
}

async function readLines(filePath: string): Promise<string[]> {
  return (await readFile(filePath, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean);
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('Timed out waiting for trace logger output.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
