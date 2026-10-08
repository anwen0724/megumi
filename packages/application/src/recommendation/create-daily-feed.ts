/*
 * Owns daily triggering, independent topic judgments and publication of saved batches.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CandidateSupplyOptions } from './discovery/create-candidate-supply';
import { maintainCandidates } from './discovery/maintain-candidates';
import { createDiscoveryBudget } from './discovery/discovery-budget';
import { judgeItems } from './discovery/judge-items';
import {
  EvidenceSchema,
  type ContentMaterial,
  type DiscoveryAttempt,
} from './content/material-contracts';
import { validateEvidence } from './content/material-storage';
import type { DailyFeedStorage } from './daily-feed-storage';
import type { RecommendationRunStorage } from './recommendation-run-storage';
import type { DiscoveryIssue } from './discovery/discovery-storage';
import type { StartDailyFeedResult } from './feed-contracts';
import {
  currentTimezone,
  localDate,
  midnight,
  shiftDate,
  publicationInterval,
  isCalendarDate,
} from './daily-calendar';

export interface DailyFeedOptions extends CandidateSupplyOptions {
  storage: DailyFeedStorage;
  runs: RecommendationRunStorage;
  timezone?: () => string;
  changed(input: { kind: 'daily_feed' | 'run'; runId?: string; resultId?: string }): void;
}

/** Returns saved results immediately while keeping one daily acquisition active. */
export function createDailyFeed(input: DailyFeedOptions) {
  const timezone = input.timezone ?? currentTimezone;
  let closed = false;
  let active:
    | {
        id: string;
        hash: string;
        delivery: Promise<void>;
        controller: AbortController;
        result: Promise<void>;
      }
    | undefined;
  const background = new Map<
    string,
    {
      controller: AbortController;
      result: Promise<void>;
    }
  >();
  const current = () => input.readConfiguration().config;
  const storage = input.storage;
  const service = {
    async start(request: {
      requestId: string;
      interestIds?: readonly string[];
    }): Promise<StartDailyFeedResult> {
      if (closed)
        throw Object.assign(new Error('Recommendation is closing.'), { code: 'SHUTTING_DOWN' });

      const { config, revision } = input.readConfiguration();
      if (!config.enabled)
        throw Object.assign(new Error('Recommendation is disabled.'), {
          code: 'RECOMMENDATION_DISABLED',
        });

      const zone = timezone();
      const date = localDate(input.now(), zone);
      const interests = (await input.interests.listInterests()).interests.filter(
        interest =>
          interest.enabled && (!request.interestIds || request.interestIds.includes(interest.id)),
      );
      const hash = createHash('sha256')
        .update(
          JSON.stringify([
            date,
            interests.map(interest => [interest.id, interest.revision]).sort(),
          ]),
        )
        .digest('hex');
      const previous = input.runs.byRequest(request.requestId);
      if (previous) {
        if (previous.input_hash !== hash)
          throw Object.assign(new Error('Request ID has different inputs.'), {
            code: 'REQUEST_CONFLICT',
          });

        return {
          status: 'joined',
          runId: previous.id,
        };
      }
      if (active?.hash === hash) {
        input.runs.joinRequest(active.id, request.requestId, hash);
        return {
          status: 'joined',
          runId: active.id,
        };
      }

      let selected = interests.filter(
        interest => !['ready', 'empty'].includes(storage.batch(date, interest)?.status ?? ''),
      );
      if (!selected.length)
        return {
          status: 'already_completed',
          batchIds: interests.flatMap(interest => {
            const batch = storage.batch(date, interest);
            return batch ? [batch.id] : [];
          }),
        };

      const id = input.newId('recommendation');
      const controller = new AbortController();
      const precedingDelivery = active?.delivery;
      let releaseDelivery: () => void = () => undefined;
      const delivery = new Promise<void>(resolve => {
        releaseDelivery = resolve;
      });
      const window = {
        start: midnight(shiftDate(date, 1 - config.dailyFeed.lookbackDays), zone),
        end: input.now(),
      };
      const windows = new Map(
        selected.map(interest => {
          const batch = storage.batch(date, interest);
          return [
            interest.id,
            batch
              ? {
                  start: batch.windowStart,
                  end: batch.windowEnd,
                }
              : (input.runs.dailyWindow(date, interest) ?? window),
          ] as const;
        }),
      );
      input.runs.create({
        id,
        kind: 'daily_feed',
        requestId: request.requestId,
        inputHash: hash,
        interests: selected,
        now: input.now(),
        outcome: {
          date,
          timezone: zone,
          windows: Object.fromEntries(windows),
        },
      });

      const result = Promise.resolve().then(async () => {
        await precedingDelivery;
        if (controller.signal.aborted) {
          input.runs.finish(id, 'cancelled', input.now(), []);
          input.changed({
            kind: 'run',
            runId: id,
          });
          return;
        }

        selected = selected.filter(
          interest => !['ready', 'empty'].includes(storage.batch(date, interest)?.status ?? ''),
        );
        if (!selected.length) {
          input.runs.finish(id, 'completed', input.now(), []);
          input.changed({
            kind: 'run',
            runId: id,
          });
          return;
        }

        input.runs.begin(id);
        input.changed({
          kind: 'run',
          runId: id,
        });

        const issues: DiscoveryIssue[] = [];
        const model = await input.resolveModel();
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(config.limits.maxDurationMinutes * 60000),
        ]);
        const budget = createDiscoveryBudget(config.limits, input.now(), input.now);
        const accepted = new Map(
          selected.map(interest => [interest.id, new Map<string, ContentMaterial>()]),
        );
        const collected = new Map(
          selected.map(interest => [interest.id, new Map<string, ContentMaterial>()]),
        );
        let committed = false;
        let attempted = new Set(selected.map(interest => interest.id));
        const states: string[] = [];
        let batchId: string | undefined;
        const batchStatuses: Record<string, string> = {};
        const commit = (complete = true) => {
          if (signal.aborted) return;

          for (const interest of selected) {
            if (!attempted.has(interest.id)) continue;

            const existing = storage.batch(date, interest);
            const items = [...accepted.get(interest.id)!.values()];
            const relevant = issues.filter(
              issue =>
                !issue.subjectId ||
                issue.subjectId === interest.id ||
                !selected.some(item => item.id === issue.subjectId),
            );
            const saved = storage.commit({
              date,
              timezone: zone,
              interest,
              window: windows.get(interest.id)!,
              items,
              issues: relevant,
              limit: config.dailyFeed.maxItemsPerInterest,
            });
            if (saved) {
              batchId ??= saved;
              const status = storage.batch(date, interest)!.status;
              states.push(status);
              batchStatuses[interest.id] = status;
              input.changed({
                kind: 'daily_feed',
                runId: id,
                resultId: saved,
              });
            }
          }

          if (!complete) return;

          const status = states.length
            ? states.every(state => state === 'ready')
              ? 'completed'
              : states.every(state => state === 'empty')
                ? 'empty'
                : states.some(state => state === 'ready' || state === 'partial')
                  ? 'partial'
                  : states.some(state => state === 'failed')
                    ? 'failed'
                    : 'empty'
            : 'superseded';
          input.runs.finish(id, status, input.now(), issues, batchId, { batchStatuses });
          input.changed({
            kind: 'run',
            runId: id,
          });
          committed = true;
          releaseDelivery();
          if (active?.id === id) active = undefined;
        };
        if (!model) {
          issues.push({
            code: 'MODEL_UNAVAILABLE',
            message: 'The daily model is unavailable.',
          });
          commit();
          return;
        }

        try {
          await maintainCandidates({
            ...input,
            runId: input.newId('discovery'),
            purpose: 'daily_feed',
            config,
            configRevision: revision,
            model,
            signal,
            budget,
            window,
            windows,
            interestIds: selected.map(interest => interest.id),

            async onMaterial(material, interest) {
              const fixed = windows.get(interest.id)!;
              const publication = publicationInterval(material);
              if (
                !publication ||
                publication.start < fixed.start ||
                publication.end > fixed.end ||
                storage.seenBefore(material.contentId, date)
              )
                return;

              collected.get(interest.id)!.set(material.contentId, material);
            },

            async onMaterialsReady(discoveryIssues, attemptedInterestIds, complete) {
              attempted = new Set(attemptedInterestIds);
              for (const issue of discoveryIssues) if (!issues.includes(issue)) issues.push(issue);

              const schema = z
                .object({
                  relation: z.enum(['related', 'unrelated', 'insufficient']),
                  evidence: z.array(EvidenceSchema),
                })
                .strict();
              for (const interest of selected) {
                if (!attempted.has(interest.id)) continue;

                const all = [...collected.get(interest.id)!.values()].filter(material => {
                  const reused = input.runs.reuse({
                    runId: id,
                    stage: 'topic',
                    contentId: material.contentId,
                    interestId: interest.id,
                    materialId: material.id,
                    inputHash: material.id + ':' + interest.revision,
                  });
                  if (reused === undefined) return true;

                  const judgment = schema.parse(reused);
                  validateEvidence(material, judgment.evidence);
                  if (judgment.relation === 'related')
                    accepted.get(interest.id)!.set(material.contentId, material);

                  return false;
                });
                for (let offset = 0; offset < all.length; offset += 5) {
                  const batch = all.slice(offset, offset + 5);
                  const attempts = new Map<string, DiscoveryAttempt>();
                  const calls = new Map<string, number>();
                  const outcomes = await judgeItems({
                    stage: 'topic',
                    instructions:
                      'Judge only whether acquired text relates to the authoritative interest. Return relation related/unrelated/insufficient and exact evidence [{materialId,quote}]. Related requires evidence. Do not assess personal fit or reading value.',
                    items: batch.map(material => ({
                      id: material.contentId,
                      data: {
                        contentId: material.contentId,
                        materialId: material.id,
                        title: material.title,
                        text: [...material.text].slice(0, 2000).join(''),
                        interest: interest.text,
                      },
                    })),

                    validate(contentId, value) {
                      const material = batch.find(item => item.contentId === contentId)!;
                      const judgment = schema.parse(value);
                      validateEvidence(material, judgment.evidence);
                      if (judgment.relation === 'related' && !judgment.evidence.length)
                        throw new Error('Related requires evidence.');

                      return judgment;
                    },

                    client: input.client,
                    model,
                    budget,
                    queue: input.modelQueue,
                    signal,
                    priority: 1,

                    beforeRequest(ids) {
                      let claimed = false;
                      for (const contentId of ids) {
                        const material = batch.find(item => item.contentId === contentId)!;
                        let attempt = attempts.get(contentId);
                        if (!attempt) {
                          attempt = input.runs.claim({
                            runId: id,
                            stage: 'topic',
                            contentId,
                            interestId: interest.id,
                            materialId: material.id,
                            inputHash: material.id + ':' + interest.revision,
                            now: input.now(),
                            deadlineAt: Math.min(
                              budget.deadlineAt,
                              input.now() + config.limits.requestTimeoutSeconds * 1000,
                            ),
                          });
                          if (attempt) attempts.set(contentId, attempt);
                        }
                        if (attempt) {
                          const previous = calls.get(contentId) ?? 0;
                          calls.set(contentId, previous + 1);
                          claimed =
                            previous === 0 || input.runs.retry(attempt, input.now()) || claimed;
                        }
                      }

                      return claimed;
                    },

                    onSuccess(contentId, judgment) {
                      const attempt = attempts.get(contentId);
                      if (
                        attempt &&
                        input.runs.save(attempt, judgment, input.now()) &&
                        judgment.relation === 'related'
                      )
                        accepted
                          .get(interest.id)!
                          .set(
                            contentId,
                            batch.find(material => material.contentId === contentId)!,
                          );
                    },

                    onIssue(code, message) {
                      issues.push({
                        code,
                        message,
                        subjectId: interest.id,
                      });
                    },
                  });
                  for (const outcome of outcomes) {
                    const failure = outcome.status === 'failed' ? outcome.code : undefined;
                    const attempt = attempts.get(outcome.id);
                    if (attempt) input.runs.release(attempt, input.now(), failure);
                    if (failure)
                      issues.push({
                        code: failure,
                        message: 'Daily topic judgment did not complete.',
                        subjectId: interest.id,
                      });
                  }
                }
              }

              commit(complete);
            },
          });
          if (signal.aborted && !committed) {
            input.runs.finish(id, 'cancelled', input.now(), issues);
            input.changed({
              kind: 'run',
              runId: id,
            });
          }
        } catch (error) {
          if (!committed) {
            issues.push({
              code: 'STORAGE_ERROR',
              message: error instanceof Error ? error.message : 'Daily delivery failed.',
            });
            input.runs.finish(id, signal.aborted ? 'cancelled' : 'failed', input.now(), issues);
            input.changed({
              kind: 'run',
              runId: id,
            });
          }
          throw error;
        }
      });
      active = {
        id,
        hash,
        delivery,
        controller,
        result,
      };
      background.set(id, {
        controller,
        result,
      });
      void result
        .finally(() => {
          releaseDelivery();
          background.delete(id);
          if (active?.id === id) active = undefined;

          input.onFinished?.();
        })
        .catch(() => undefined);

      return {
        status: 'started',
        runId: id,
      };
    },

    list(
      request: {
        date?: string;
      } = {},
    ) {
      const today = localDate(input.now(), timezone());
      const date = request.date ?? today;
      if (date > today || date < shiftDate(today, -6) || !isCalendarDate(date)) {
        throw Object.assign(new Error('Daily date is outside the retained seven dates.'), {
          code: 'DATE_OUT_OF_RANGE',
        });
      }

      return storage.list(date, current().dailyFeed.maxItemsPerDay);
    },

    async check(force = false) {
      if (closed || !current().enabled) return;

      const time = input.now();
      const zone = timezone();
      const date = localDate(time, zone);
      const [hours, minutes] = current().dailyFeed.runAt.split(':').map(Number);
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .format(time)
        .split(':')
        .map(Number);
      if (!force && parts[0]! * 60 + parts[1]! < hours! * 60 + minutes!) return;

      const interests = (await input.interests.listInterests()).interests.filter(interest => {
        if (!interest.enabled) return false;

        const batch = storage.batch(date, interest);
        if (batch && ['ready', 'empty', 'partial'].includes(batch.status)) return false;

        const attempts = storage.attempts(date, interest);

        return (
          attempts.failures < 3 &&
          (attempts.last_finished_at === null || attempts.last_finished_at + 5 * 60000 <= time)
        );
      });
      if (interests.length)
        await service.start({
          requestId: 'auto-daily:' + date + ':' + input.newId('request'),
          interestIds: interests.map(interest => interest.id),
        });
    },

    async completion() {
      await Promise.all([...background.values()].map(work => work.result));
    },

    cancel(runId?: string) {
      if (!runId) {
        for (const work of background.values()) work.controller.abort();

        return background.size ? ('cancelling' as const) : ('already_finished' as const);
      }

      const work = background.get(runId);
      if (work) {
        work.controller.abort();
        return 'cancelling' as const;
      }

      return 'already_finished' as const;
    },

    async close() {
      closed = true;
      for (const work of background.values()) work.controller.abort();

      await Promise.allSettled([...background.values()].map(work => work.result));
    },
  };

  return service;
}
