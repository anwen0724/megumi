/*
 * Selects saved candidates, keeping model evaluation outside the atomic publication boundary.
 */
import { createHash } from 'node:crypto';
import { estimateTextTokens } from '@megumi/ai/utils/estimate';
import { z } from 'zod';
import type { CandidateSupplyOptions } from './discovery/create-candidate-supply';
import { createDiscoveryBudget } from './discovery/discovery-budget';
import { judgeItems } from './discovery/judge-items';
import { callTextModel } from './call-text-model';
import { validateEvidence } from './content/material-storage';
import type { DiscoveryAttempt } from './content/material-contracts';
import type { DiscoveryIssue } from './discovery/discovery-storage';
import type { DiscoveryStorage } from './discovery/discovery-storage';
import { interestSetHash } from './interests/interest-set';
import type { RecommendationRunStorage } from './recommendation-run-storage';
import type { CuratedSelectionStorage, CuratedInput } from './curated-selection-storage';
import {
  ValueJudgmentSchema,
  SelectionComparisonSchema,
  type ValueJudgment,
  type StartCuratedSelectionResult,
} from './curated-contracts';
import { validateSelectionConstraints } from './selection-constraints';

export interface CuratedSelectionOptions
  extends Pick<
    CandidateSupplyOptions,
    | 'candidates'
    | 'interests'
    | 'client'
    | 'modelQueue'
    | 'now'
    | 'readConfiguration'
    | 'newId'
    | 'resolveModel'
  > {
  storage: CuratedSelectionStorage;
  runs: RecommendationRunStorage;
  changed(event: { kind: 'run' | 'curated_selection'; runId: string; resultId?: string }): void;
  onError?(error: unknown): void;
  discovery: Pick<DiscoveryStorage, 'requestSupplement'>;
}

/** One active selection freezes its inputs before returning acceptance; queries never start it. */
export function createCuratedSelection(input: CuratedSelectionOptions) {
  let closed = false;
  let checking = false;
  let active:
    | {
        id: string;
        hash: string;
        controller: AbortController;
        result: Promise<void>;
      }
    | undefined;
  const executions = new Map<
    string,
    {
      controller: AbortController;
      result: Promise<void>;
    }
  >();
  const service = {
    /** Accepts one initial or changed-set run; a completed set is not refreshed by new supply. */
    async check() {
      if (closed || checking || !input.readConfiguration().config.enabled) return;

      checking = true;

      try {
        const interests = (await input.interests.listInterests()).interests.filter(
          item => item.enabled,
        );
        const hash = interestSetHash(interests);
        if (active?.hash === hash) return;
        if (active) {
          active.controller.abort();
          input.runs.finish(active.id, 'superseded', input.now(), [
            {
              code: 'INPUT_CHANGED',
              message: 'The authoritative interest set changed.',
            },
          ]);
          active = undefined;
        }
        if (!interests.length) return;
        if (
          input.storage.current()?.interestHash === hash ||
          input.storage.automaticState()?.finished_automatic_interest_hash === hash
        )
          return;

        input.storage.waitForInterestSet(hash);
        const state = input.storage.automaticState()!;
        if (state.automatic_retry_count >= 3 || (state.next_retry_at ?? 0) > input.now()) return;

        const config = input.readConfiguration().config;
        if (
          !input.candidates.listCandidates(input.now(), {
            contentLanguages: config.candidateSupply.contentLanguages,
          }).length
        )
          return;

        const attempt = input.storage.beginAutomatic(hash);
        await service.start({
          requestId: `automatic:${hash}:${attempt}`,
          automatic: true,
        });
      } finally {
        checking = false;
      }
    },

    async start(request: {
      requestId: string;
      automatic?: boolean;
    }): Promise<StartCuratedSelectionResult> {
      if (closed)
        throw Object.assign(new Error('Recommendation is closing.'), { code: 'SHUTTING_DOWN' });

      const { config } = input.readConfiguration();
      if (!config.enabled)
        throw Object.assign(new Error('Recommendation is disabled.'), {
          code: 'RECOMMENDATION_DISABLED',
        });

      const interests = (await input.interests.listInterests()).interests.filter(
        item => item.enabled,
      );
      const hash = interestSetHash(interests);
      const previous = input.runs.byRequest(request.requestId);
      if (previous) {
        if (previous.input_hash !== hash)
          throw Object.assign(new Error('Request ID has different inputs.'), {
            code: 'REQUEST_CONFLICT',
          });

        const outcome = previous.outcome
          ? z.record(z.unknown()).parse(JSON.parse(previous.outcome))
          : {};
        return outcome.result === 'no_candidates'
          ? { status: 'no_candidates' }
          : {
              status: 'joined',
              runId: previous.id,
            };
      }
      if (active && active.hash === hash) {
        input.runs.joinRequest(active.id, request.requestId, hash);
        return {
          status: 'joined',
          runId: active.id,
        };
      }
      if (active) {
        active.controller.abort();
        input.runs.finish(active.id, 'superseded', input.now(), [
          {
            code: 'INPUT_CHANGED',
            message: 'The authoritative interest set changed.',
          },
        ]);
        active = undefined;
      }

      const current = input.storage.current();
      const excludeContentIds = request.automatic
        ? []
        : (current?.selection.items.map(item => item.contentId) ?? []);
      const window = {
        interestIds: interests.map(item => item.id),
        contentLanguages: config.candidateSupply.contentLanguages,
        excludeContentIds,
        currentContentIds: current?.selection.items.map(item => item.contentId) ?? [],
      };
      const id = input.newId('recommendation');
      const frozenInputs = input.storage.freezeInputs({
        id,
        requestId: request.requestId,
        interestHash: hash,
        interests,
        automatic: request.automatic ?? false,

        select: now =>
          input.candidates.selectInputs(now, {
            ...window,
            limit: config.curated.maxCandidateCount,
          }),
      });
      if (!frozenInputs)
        return {
          status: 'started',
          runId: id,
        };

      const candidates = frozenInputs;
      if (!candidates.length) {
        input.discovery.requestSupplement(interests, excludeContentIds, input.now());
        input.runs.finish(id, 'completed', input.now(), [], undefined, { result: 'no_candidates' });
        return { status: 'no_candidates' };
      }

      const controller = new AbortController();

      /** Evaluates only frozen inputs and publishes the surviving result before notification. */
      async function executeSelection() {
        input.runs.begin(id);
        input.changed({
          kind: 'run',
          runId: id,
        });

        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(config.limits.maxDurationMinutes * 60000),
        ]);
        const issues: DiscoveryIssue[] = [];
        const attempts = new Map<string, DiscoveryAttempt>();

        try {
          const model = await input.resolveModel();
          if (!model) {
            issues.push({
              code: 'MODEL_UNAVAILABLE',
              message: 'The recommendation model is unavailable.',
            });
            input.runs.finish(id, 'failed', input.now(), issues);
            return;
          }

          const budget = createDiscoveryBudget(config.limits, input.now(), input.now);
          const values = new Map<string, ValueJudgment>();
          const counts = new Map<string, number>();
          const data = (candidate: CuratedInput) => ({
            contentId: candidate.contentId,
            materialId: candidate.materialId,
            materialKind: candidate.material.kind,
            truncated: candidate.material.truncated,
            title: candidate.material.title,
            summary: candidate.analysis.summary,
            keyPoints: candidate.analysis.keyPoints,
            qualifications: candidate.qualifications,
            interests,
          });
          const itemHash = (candidate: CuratedInput) =>
            createHash('sha256')
              .update(JSON.stringify(['value:2', data(candidate)]))
              .digest('hex');
          const validate = (candidate: CuratedInput, value: unknown) => {
            const judgment = ValueJudgmentSchema.parse(value);
            validateEvidence(candidate.material, judgment.evidence);
            if (
              new Set(judgment.matchedInterestIds).size !== judgment.matchedInterestIds.length ||
              judgment.matchedInterestIds.some(
                id => !candidate.qualifications.some(pair => pair.interestId === id),
              )
            )
              throw new Error('Value refers to an interest outside the frozen qualification.');
            if (
              judgment.worthReading &&
              (!judgment.evidence.length || !judgment.matchedInterestIds.length)
            )
              throw new Error('Reading value requires material evidence and a matched interest.');

            return judgment;
          };
          const pending = candidates.filter(candidate => {
            const reused = input.runs.reuse({
              runId: id,
              stage: 'value',
              contentId: candidate.contentId,
              interestId: candidate.qualifications[0]!.interestId,
              materialId: candidate.materialId,
              inputHash: itemHash(candidate),
            });
            if (reused === undefined) return true;

            values.set(candidate.contentId, validate(candidate, reused));

            return false;
          });
          const outcomes = await judgeItems({
            stage: 'value',
            instructions:
              'Judge whether the acquired material offers concrete knowledge, methods, evidence, experience or useful new information for an authoritative interest. Respect explicit geography and other constraints. An excerpt or description only proves what it actually contains; do not promise methods, detail or conclusions from unseen full text. Bare promises of a review, tutorial or practical tips do not provide concrete information: return worthReading=false when no actual finding, method, example, limitation or specific release fact is acquired. A generic product landing page or name-only list is insufficient. Do not infer access, occupation or membership that the interest did not state; a resource restricted to a particular institution is not usable without such a match. Distinguish attributed promotional claims from independently supported facts. Each result must use exactly these fields: {"worthReading":true,"reason":"a concise reading reason","evidence":[{"materialId":"the supplied materialId","quote":"an exact quote from supplied evidence"}],"matchedInterestIds":["a supplied qualified interest id"]}. evidence is an array of objects, never a string or an array of strings; do not rename it materialEvidence. Use a reason of at most 80 Chinese characters or 40 English words and one short exact evidence quote when sufficient. Do not score items against their batch or invent knowledge of user reading history.',
            items: pending.map(candidate => ({
              id: candidate.contentId,
              data: data(candidate),
            })),
            client: input.client,
            model,
            budget,
            queue: input.modelQueue,
            signal,

            validate(contentId, value) {
              return validate(
                candidates.find(candidate => candidate.contentId === contentId)!,
                value,
              );
            },

            beforeRequest(ids) {
              let claimed = false;
              for (const contentId of ids) {
                const candidate = candidates.find(item => item.contentId === contentId)!;
                let attempt = attempts.get(contentId);
                if (!attempt) {
                  attempt = input.runs.claim({
                    runId: id,
                    stage: 'value',
                    contentId,
                    interestId: candidate.qualifications[0]!.interestId,
                    materialId: candidate.materialId,
                    inputHash: itemHash(candidate),
                    now: input.now(),
                    deadlineAt: Math.min(
                      budget.deadlineAt,
                      input.now() + config.limits.requestTimeoutSeconds * 1000,
                    ),
                  });
                  if (attempt) attempts.set(contentId, attempt);
                }
                if (attempt) {
                  const count = counts.get(contentId) ?? 0;
                  counts.set(contentId, count + 1);
                  claimed = count === 0 || input.runs.retry(attempt, input.now()) || claimed;
                }
              }

              return claimed;
            },

            onSuccess(contentId, value) {
              const attempt = attempts.get(contentId);
              if (!attempt || !input.runs.save(attempt, value, input.now()))
                throw new Error('Value attempt is no longer owned.');

              values.set(contentId, value);
            },

            onIssue(code, message) {
              issues.push({
                code,
                message,
              });
            },
          });
          for (const outcome of outcomes)
            if (outcome.status === 'failed') {
              issues.push({
                code: outcome.code,
                message: outcome.message,
                subjectId: outcome.id,
              });

              const attempt = attempts.get(outcome.id);
              if (attempt) input.runs.release(attempt, input.now(), outcome.code);
            }

          if (signal.aborted) {
            input.runs.finish(id, 'cancelled', input.now(), issues);
            return;
          }

          const valuable = candidates
            .filter(candidate => values.get(candidate.contentId)?.worthReading)
            .map(candidate => ({
              ...candidate,
              qualifications: candidate.qualifications.filter(pair =>
                values.get(candidate.contentId)?.matchedInterestIds.includes(pair.interestId),
              ),
            }));
          let shortlist = input.candidates.selectInputs(input.now(), {
            ...window,
            candidates: valuable,
            limit: config.curated.shortlistCount,
          });
          if (!shortlist.length) {
            input.runs.finish(
              id,
              issues.length ? 'failed' : 'completed',
              input.now(),
              issues,
              undefined,
              { result: issues.length ? 'failed' : 'no_change' },
            );
            return;
          }

          const system = `Compare the complete supplied shortlist. Select at most the target count, at most ${config.curated.maxItemsPerPublisher} items per publisher key, and one per duplicate group. Each item must have contentId, reason, exact evidence [{materialId,quote}] and matchedInterestIds. Cover supplied interests before allocating extra slots; respect explicit geography and other constraints. Reasons must stay within the acquired material kind and evidence, without promising unseen full-text details or treating advertising claims as verified facts. Keep each reason under 80 Chinese characters or 40 English words, with one short exact evidence quote when sufficient. Never invent identifiers or facts. Return {items:[...]}.`;
          const covered = new Set(
            current?.selection.items.flatMap(item =>
              item.interestLabels.map(label => label.interestId),
            ),
          );
          const interestPriority = [...interests]
            .sort((a, b) => Number(covered.has(a.id)) - Number(covered.has(b.id)))
            .map(item => item.id);
          const comparisonPrompt = (items: readonly CuratedInput[], correction?: string) =>
            JSON.stringify({
              stage: 'selection',
              targetCount: config.curated.targetCount,
              interests,
              interestPriority,
              items: items.map(candidate => ({
                id: candidate.contentId,
                publisherKeys: candidate.publisherKeys,
                ...data(candidate),
                value: values.get(candidate.contentId),
              })),
              correction,
            });
          const inputLimit = Math.min(
            config.limits.maxRequestInputTokens,
            model.contextWindow - Math.min(config.limits.maxRequestOutputTokens, model.maxTokens),
            config.limits.maxModelInputTokens - budget.snapshot().used.modelInputTokens,
          );
          const admitted: CuratedInput[] = [];
          for (const candidate of shortlist)
            if (
              estimateTextTokens(system + '\n' + comparisonPrompt([...admitted, candidate])) <=
              inputLimit
            )
              admitted.push(candidate);

          if (!admitted.length) {
            input.runs.finish(id, 'failed', input.now(), [
              ...issues,
              {
                code: 'INPUT_TOO_LARGE',
                message: 'No complete shortlist entry fits the final comparison input.',
              },
            ]);
            return;
          }
          if (admitted.length < shortlist.length)
            issues.push({
              code: 'SHORTLIST_INPUT_LIMIT',
              message:
                'Some candidates remain in the pool because the complete final input reached its budget.',
            });

          shortlist = admitted;
          let correction: string | undefined;
          for (let attempt = 0; attempt < 2; attempt++) {
            const prompt = comparisonPrompt(shortlist, correction);
            const reserved = budget.reserveModel('selectionCalls', model, system, prompt);
            if (typeof reserved === 'string') {
              issues.push({
                code: reserved.toUpperCase(),
                message: 'The final comparison could not obtain its budget.',
              });
              break;
            }

            const callSignal = AbortSignal.any([
              signal,
              AbortSignal.timeout(config.limits.requestTimeoutSeconds * 1000),
            ]);
            let executed = false;
            const response = await input.modelQueue
              .run(() => {
                executed = true;
                return callTextModel(input.client, {
                  model,
                  systemPrompt: system,
                  prompt,
                  schema: SelectionComparisonSchema,
                  maxOutputTokens: reserved.output,
                  signal: callSignal,
                });
              }, callSignal)
              .finally(() => {
                if (!executed) budget.releaseModel('selectionCalls', reserved);
              });
            if (response.status === 'failed') {
              if (response.code === 'INVALID_RESULT' && attempt === 0) {
                correction = response.message;
                continue;
              }

              issues.push({
                code: response.code === 'INVALID_RESULT' ? 'MODEL_OUTPUT_INVALID' : response.code,
                message: response.message,
              });
              break;
            }

            budget.settleModel(reserved, response.record.usage);

            try {
              validateSelectionConstraints(response.result.items, shortlist, {
                targetCount: config.curated.targetCount,
                maxItemsPerPublisher: config.curated.maxItemsPerPublisher,
                interestPriority,
              });
              for (const item of response.result.items) {
                const candidate = shortlist.find(
                  candidate => candidate.contentId === item.contentId,
                );
                if (!candidate)
                  throw new Error('The selected content is outside the frozen shortlist.');

                const { contentId, ...judgment } = item;
                validate(candidate, {
                  ...judgment,
                  worthReading: true,
                });
              }
            } catch (error) {
              correction = error instanceof Error ? error.message : 'Invalid final comparison.';
              if (attempt === 0) continue;

              issues.push({
                code: 'MODEL_OUTPUT_INVALID',
                message: correction,
              });
              break;
            }

            if (signal.aborted) {
              input.runs.finish(id, 'cancelled', input.now(), issues);
              return;
            }

            const published = input.storage.publish({
              runId: id,
              interestHash: hash,
              inputs: candidates,
              selected: response.result.items,
              targetCount: config.curated.targetCount,
              contentLanguages: input.readConfiguration().config.candidateSupply.contentLanguages,
              issues,
            });
            if (published.status === 'partial' || published.status === 'no_change')
              input.discovery.requestSupplement(interests, excludeContentIds, input.now());
            if ('selectionId' in published)
              input.changed({
                kind: 'curated_selection',
                runId: id,
                resultId: published.selectionId,
              });

            return;
          }

          input.runs.finish(id, 'failed', input.now(), issues);
        } catch (error) {
          input.onError?.(error);
          input.runs.finish(id, signal.aborted ? 'cancelled' : 'failed', input.now(), [
            ...issues,
            {
              code: 'STORAGE_ERROR',
              message: 'The selection could not be published.',
            },
          ]);
        } finally {
          for (const attempt of attempts.values()) input.runs.release(attempt, input.now());

          if (request.automatic)
            input.storage.finishAutomatic(
              hash,
              input.runs.read(id)?.status ?? 'failed',
              input.now(),
            );
          if (active?.id === id) active = undefined;

          input.changed({
            kind: 'run',
            runId: id,
          });
        }
      }

      const result = Promise.resolve().then(executeSelection);
      active = {
        id,
        hash,
        controller,
        result,
      };
      executions.set(id, {
        controller,
        result,
      });
      void result
        .finally(() => {
          executions.delete(id);
          if (active?.id === id) active = undefined;
        })
        .catch(() => undefined);

      return {
        status: 'started',
        runId: id,
      };
    },

    activeRun() {
      return active?.id;
    },

    async completion() {
      await Promise.all([...executions.values()].map(execution => execution.result));
    },

    cancel(runId?: string) {
      if (active && (!runId || active.id === runId)) {
        active.controller.abort();
        return 'cancelling' as const;
      }

      return 'already_finished' as const;
    },

    async close() {
      closed = true;
      for (const execution of executions.values()) execution.controller.abort();

      await service.completion();
    },
  };

  return service;
}
