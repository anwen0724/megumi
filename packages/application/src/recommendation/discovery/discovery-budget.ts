/*
 * Reserves each run's source requests, stage calls and model tokens before work enters a queue.
 */
import { estimateTextTokens } from '@megumi/ai/utils/estimate';
import type { RecommendationConfiguration } from '../../settings/definitions/recommendation';
import type { Api, Model } from '@megumi/ai';

export type DiscoveryLimits = RecommendationConfiguration['limits'];

export type RunCall =
  | 'searchCalls'
  | 'fetchCalls'
  | 'sourceRequests'
  | 'planningCalls'
  | 'analysisCalls'
  | 'matchingCalls'
  | 'judgmentCalls'
  | 'selectionCalls';

export type RunUsage = Record<RunCall | 'modelInputTokens' | 'modelOutputTokens', number>;

const FIELDS = {
  searchCalls: 'maxSearchCalls',
  fetchCalls: 'maxFetchCalls',
  sourceRequests: 'maxSourceRequests',
  planningCalls: 'maxPlanningCalls',
  analysisCalls: 'maxAnalysisCalls',
  matchingCalls: 'maxMatchingCalls',
  judgmentCalls: 'maxJudgmentCalls',
  selectionCalls: 'maxSelectionCalls',
} as const;

export function createDiscoveryBudget(
  limits: DiscoveryLimits,
  startedAt: number,
  now: () => number,
  used?: RunUsage,
) {
  const usage: RunUsage = used
    ? { ...used }
    : {
        searchCalls: 0,
        fetchCalls: 0,
        sourceRequests: 0,
        planningCalls: 0,
        analysisCalls: 0,
        matchingCalls: 0,
        judgmentCalls: 0,
        selectionCalls: 0,
        modelInputTokens: 0,
        modelOutputTokens: 0,
      };
  const deadlineAt = startedAt + limits.maxDurationMinutes * 60000;
  return {
    deadlineAt,
    expired: () => now() >= deadlineAt,
    remaining: (kind: RunCall) => Math.max(0, limits[FIELDS[kind]] - usage[kind]),

    snapshot: () => ({
      limits,
      used: { ...usage },
    }),

    reserve(kind: RunCall, count = 1) {
      if (now() >= deadlineAt || usage[kind] + count > limits[FIELDS[kind]]) return false;

      usage[kind] += count;
      return true;
    },

    release(kind: RunCall) {
      usage[kind] = Math.max(0, usage[kind] - 1);
    },

    reserveModel(kind: RunCall, model: Model<Api>, system: string, prompt: string) {
      const input = estimateTextTokens(system + '\n' + prompt);
      const output = Math.min(limits.maxRequestOutputTokens, model.maxTokens);
      if (input > Math.min(limits.maxRequestInputTokens, model.contextWindow - output))
        return 'input_too_large' as const;
      if (
        now() >= deadlineAt ||
        usage[kind] >= limits[FIELDS[kind]] ||
        usage.modelInputTokens + input > limits.maxModelInputTokens ||
        usage.modelOutputTokens + output > limits.maxModelOutputTokens
      )
        return 'budget_exhausted' as const;

      usage[kind]++;
      usage.modelInputTokens += input;
      usage.modelOutputTokens += output;

      return {
        input,
        output,
      };
    },

    settleModel(
      reserved: {
        input: number;
        output: number;
      },
      actual: {
        input: number;
        output: number;
      },
    ) {
      usage.modelInputTokens += actual.input - reserved.input;
      usage.modelOutputTokens += actual.output - reserved.output;
    },

    /** Removes a reservation when cancellation or lost ownership prevents execution. */
    releaseModel(
      kind: RunCall,
      reserved: {
        input: number;
        output: number;
      },
    ) {
      usage[kind]--;
      usage.modelInputTokens -= reserved.input;
      usage.modelOutputTokens -= reserved.output;
    },
  };
}

export type DiscoveryBudget = ReturnType<typeof createDiscoveryBudget>;
