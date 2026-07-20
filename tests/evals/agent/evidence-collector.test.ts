/* Verifies evidence uses Host facts and bounded, explicitly declared workspace files. */
// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectEvaluationEvidence } from '../../../evals/agent/runner/evidence-collector';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('collectEvaluationEvidence', () => {
  it('collects declared files only, records truncation, and uses Session final reply', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-evidence-'));
    roots.push(root);
    await mkdir(path.join(root, 'out'));
    await writeFile(path.join(root, 'out', 'answer.md'), '0123456789', 'utf8');
    await writeFile(path.join(root, 'unrelated.txt'), 'must not be read', 'utf8');
    const getRunTrace = vi.fn().mockResolvedValue({
      status: 'found',
      trace: {
        summary: { traceId: 'trace-1', runId: 'run-1', status: 'ok', startedAt: 'now', modelCallCount: 1, toolCallCount: 0 },
        spans: [], logs: [], measurements: [], droppedRecordCount: 0,
      },
    });

    const evidence = await collectEvaluationEvidence({
      workspaceRoot: root,
      declaredWorkspacePaths: ['out/answer.md', 'missing.md'],
      maximumFileBytes: 5,
      maximumTotalBytes: 20,
      sessionId: 'session-1',
      messages: [
        { role: 'assistant', text: 'draft' },
        { role: 'assistant', text: 'final answer' },
      ],
      timeline: [{ kind: 'assistant' }],
      runtimeEvents: [],
      runtimeEventsComplete: true,
      runId: 'run-1',
      observabilityHost: { getRunTrace },
    });

    expect(evidence.session.finalReply).toBe('final answer');
    expect(evidence.workspace.files).toEqual([
      expect.objectContaining({ path: 'out/answer.md', exists: true, content: '01234', truncated: true }),
      expect.objectContaining({ path: 'missing.md', exists: false }),
    ]);
    expect(JSON.stringify(evidence)).not.toContain('must not be read');
    expect(evidence.diagnostics?.available).toBe(true);
  });

  it('marks observability unavailable without changing other evidence', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-evidence-'));
    roots.push(root);
    const evidence = await collectEvaluationEvidence({
      workspaceRoot: root,
      declaredWorkspacePaths: [],
      sessionId: 'session-1', messages: [], timeline: [], runtimeEvents: [], runtimeEventsComplete: false,
      runId: 'run-1',
      observabilityHost: { getRunTrace: vi.fn().mockRejectedValue(new Error('diagnostics offline')) },
    });
    expect(evidence.session.complete).toBe(true);
    expect(evidence.runtimeEvents.complete).toBe(false);
    expect(evidence.diagnostics).toEqual({ available: false, error: 'diagnostics offline' });
  });
});
