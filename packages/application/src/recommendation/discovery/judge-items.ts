/*
 * Preserves independently valid judgments and retries only the failed input items once.
 */
import type { Api, Model } from '@megumi/ai';
import { z } from 'zod';
import { estimateTextTokens } from '@megumi/ai/utils/estimate';
import { callTextModel, type TextModelClient } from '../call-text-model';
import type { DiscoveryBudget, RunCall } from './discovery-budget';
import type { SourceQueue } from './source-queue';

export interface JudgmentItem {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

export type JudgmentOutcome<T> =
  | {
      id: string;
      status: 'ready';
      result: T;
    }
  | {
      id: string;
      status: 'failed';
      code: string;
      message: string;
    };

export async function judgeItems<T>(input: {
  stage: 'analysis' | 'matching' | 'topic' | 'value';
  instructions: string;
  items: readonly JudgmentItem[];
  validate: (id: string, value: unknown) => T;
  client: TextModelClient;
  model: Model<Api>;
  budget: DiscoveryBudget;
  queue: SourceQueue;
  signal: AbortSignal;
  priority?: number;
  onSuccess?: (id: string, result: T) => void;
  beforeRetry?: (id: string) => boolean;
  beforeRequest?: (ids: readonly string[]) => boolean;
  onIssue?: (code: string, message: string) => void;
}): Promise<readonly JudgmentOutcome<T>[]> {
  const results = new Map<string, JudgmentOutcome<T>>();
  const kind: RunCall =
    input.stage === 'analysis'
      ? 'analysisCalls'
      : input.stage === 'matching'
        ? 'matchingCalls'
        : input.stage === 'topic'
          ? 'judgmentCalls'
          : 'selectionCalls';
  const system =
    input.instructions +
    '\nReturn JSON {"items":[{"id":"the exact supplied id","result":{...}}]}. Each result is independent of other input items. Never invent identifiers or source facts.';
  const promptFor = (items: readonly JudgmentItem[], correction?: Record<string, string>) =>
    JSON.stringify({
      stage: input.stage,
      items: items.map(item => ({
        id: item.id,
        ...item.data,
      })),
      ...(correction ? { correction } : {}),
    });
  const call = async (items: readonly JudgmentItem[], correction?: Record<string, string>) => {
    const prompt = promptFor(items, correction);
    const reserved = input.budget.reserveModel(kind, input.model, system, prompt);
    if (typeof reserved === 'string')
      return {
        status: 'failed' as const,
        code: reserved.toUpperCase(),
        message: reserved,
      };

    let executed = false;

    try {
      const signal = AbortSignal.any([
        input.signal,
        AbortSignal.timeout(input.budget.snapshot().limits.requestTimeoutSeconds * 1000),
      ]);
      const response = await input.queue.run(
        async () => {
          if (input.beforeRequest && !input.beforeRequest(items.map(item => item.id)))
            return {
              status: 'failed' as const,
              code: 'INPUT_CLAIMED',
              message: 'The input was claimed or changed.',
            };

          executed = true;
          return callTextModel(input.client, {
            model: input.model,
            systemPrompt: system,
            prompt,
            schema: z.object({ items: z.array(z.unknown()) }),
            maxOutputTokens: reserved.output,
            signal,
          });
        },
        signal,
        input.priority,
      );
      if (response.status === 'ok') input.budget.settleModel(reserved, response.record.usage);

      return response;
    } catch {
      return {
        status: 'failed' as const,
        code: 'CANCELLED',
        message: 'Judgment was cancelled.',
      };
    } finally {
      if (!executed) input.budget.releaseModel(kind, reserved);
    }
  };
  const accept = (items: readonly JudgmentItem[], output: readonly unknown[]) => {
    const grouped = new Map<string, unknown[]>();
    for (const entry of output) {
      if (entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string') {
        if (!items.some(item => item.id === entry.id))
          input.onIssue?.(
            'UNKNOWN_RESULT_ID',
            'Model returned an identifier that was not supplied.',
          );
        else grouped.set(entry.id, [...(grouped.get(entry.id) ?? []), entry]);
      }
    }

    for (const item of items) {
      try {
        const entries = grouped.get(item.id);
        if (entries?.length !== 1)
          throw new Error(entries ? 'Duplicate identifier.' : 'Missing identifier.');

        const entry = z
          .object({
            id: z.string(),
            result: z.unknown(),
          })
          .strict()
          .parse(entries[0]);
        const result = input.validate(item.id, entry.result);
        if (input.signal.aborted) throw new Error('Judgment was cancelled.');

        input.onSuccess?.(item.id, result);
        results.set(item.id, {
          id: item.id,
          status: 'ready',
          result,
        });
      } catch (error) {
        results.set(item.id, {
          id: item.id,
          status: 'failed',
          code: 'MODEL_OUTPUT_INVALID',
          message: error instanceof Error ? error.message : 'Invalid judgment.',
        });
      }
    }
  };

  async function runBatch(items: readonly JudgmentItem[], splitAllowed: boolean) {
    if (!items.length) return;

    const response = await call(items);
    if (response.status === 'failed') {
      if (
        splitAllowed &&
        items.length > 1 &&
        ['CONTEXT_OVERFLOW', 'INPUT_TOO_LARGE'].includes(response.code)
      ) {
        const mid = Math.ceil(items.length / 2);
        await runBatch(items.slice(0, mid), false);
        await runBatch(items.slice(mid), false);
      } else
        for (const item of items)
          results.set(item.id, {
            id: item.id,
            status: 'failed',
            code: response.code,
            message: response.message,
          });
      return;
    }

    accept(items, response.result.items);
    const failed = items.filter(
      item =>
        results.get(item.id)?.status === 'failed' &&
        (!input.beforeRetry || input.beforeRetry(item.id)),
    );
    if (failed.length && !input.signal.aborted) {
      const correction = Object.fromEntries(
        failed.map(item => [
          item.id,
          (
            results.get(item.id) as {
              message: string;
            }
          ).message,
        ]),
      );
      const retried = await call(failed, correction);
      if (retried.status === 'ok') accept(failed, retried.result.items);
      else
        for (const item of failed)
          results.set(item.id, {
            id: item.id,
            status: 'failed',
            code: retried.code,
            message: retried.message,
          });
    }
  }

  const limits = input.budget.snapshot().limits;
  const outputLimit = Math.min(limits.maxRequestOutputTokens, input.model.maxTokens);
  const inputLimit = Math.min(
    limits.maxRequestInputTokens,
    input.model.contextWindow - outputLimit,
  );
  // Value replies contain prose and quoted evidence; leave room for each complete result.
  const itemLimit = input.stage === 'value' ? Math.max(1, Math.floor(outputLimit / 600)) : Infinity;
  let batch: JudgmentItem[] = [];
  for (const item of input.items) {
    if (
      batch.length &&
      (batch.length >= itemLimit ||
        estimateTextTokens(system + '\n' + promptFor([...batch, item])) > inputLimit)
    ) {
      await runBatch(batch, true);
      batch = [];
    }

    batch.push(item);
  }

  await runBatch(batch, true);

  return input.items.map(item => results.get(item.id)!);
}
