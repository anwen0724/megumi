/* Runs semantic grading with a separately configured real model and strict JSON output. */
import {
  createModels,
  createProvider,
  contentText,
  type Api,
  type Model,
  type ProviderStreams,
} from '@megumi/ai';
import { anthropicMessagesApi } from '@megumi/ai/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from '@megumi/ai/api/google-generative-ai.lazy';
import { openAICodexResponsesApi } from '@megumi/ai/api/openai-codex-responses.lazy';
import { openAICompletionsApi } from '@megumi/ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@megumi/ai/api/openai-responses.lazy';
import { builtinProviders } from '@megumi/ai/providers/all';
import { z } from 'zod';
import type { EvaluationCase } from '../catalog/evaluation-case';
import type { EvaluationModelConfig } from '../catalog/evaluation-run-config';
import type { EvidenceBundle } from './evidence';
import { GraderResultSchema, type GraderResult } from './grading';

const MODEL_GRADER_PROMPT_VERSION = 'agent-quality-grader-v1';
const MODEL_GRADER_RULE_VERSION = 'semantic-dimension-0-4-v1';
const ResponseSchema = z.object({
  grades: z.array(z.object({
    dimension: z.string().min(1),
    judgement: z.enum(['pass', 'fail', 'not_gradable']),
    score: z.number().int().min(0).max(4).optional(),
    rationale: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)),
  }).strict()),
}).strict();

export interface ModelGrader {
  grade(input: {
    readonly evaluationCase: EvaluationCase;
    readonly evidence: EvidenceBundle;
    readonly now: string;
  }): Promise<ModelGradingOutcome>;
}

export interface ModelGradingOutcome {
  readonly grades: readonly GraderResult[];
  readonly usage: {
    readonly modelCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostUsd: number;
  };
}

export function createModelGrader(input: {
  readonly config: EvaluationModelConfig;
  readonly apiKey: string;
}): ModelGrader {
  const models = createModels();
  const builtins = builtinProviders();
  const builtinProvider = builtins.find((provider) => provider.id === input.config.providerId);
  const baseUrl = input.config.baseUrl ?? builtinProvider?.baseUrl;
  if (!baseUrl) {
    throw new Error(`Evaluation Grader provider requires a base URL: ${input.config.providerId}.`);
  }
  const builtinModel = builtinProvider?.getModels().find((model) => (
    model.id === input.config.modelId
    && model.api === input.config.api
    && model.baseUrl === baseUrl
  ));
  const model = modelFromConfig(input.config, baseUrl, builtinModel);
  models.setProvider(createProvider({
    id: input.config.providerId,
    name: input.config.providerId,
    baseUrl,
    auth: {
      apiKey: {
        name: `${input.config.providerId} Evaluation key`,
        resolve: async () => ({ auth: { apiKey: input.apiKey }, source: 'Evaluation environment' }),
      },
    },
    models: [model],
    api: apiImplementation(input.config.api),
  }));
  return {
    async grade(request) {
      const dimensions = request.evaluationCase.grading.modelGradedDimensions;
      if (dimensions.length === 0) return {
        grades: [],
        usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
      };
      const response = await models.completeSimple(model, {
        systemPrompt: [
          'You grade Megumi Agent behavior from supplied evidence only.',
          'Grade every requested dimension independently from 0 to 4.',
          'Score 3 means the requirement is met. Use not_gradable when necessary evidence is missing.',
          'Return only JSON matching the requested structure.',
        ].join('\n'),
        messages: [{
          role: 'user',
          content: [{
            type: 'text',
            text: JSON.stringify({
              objective: request.evaluationCase.objective,
              dimensions,
              evidence: request.evidence,
              output: { grades: [{ dimension: 'string', judgement: 'pass|fail|not_gradable', score: '0-4', rationale: 'string', evidenceRefs: ['string'] }] },
            }),
          }],
          timestamp: Date.now(),
        }],
      });
      if (response.stopReason === 'error' || response.stopReason === 'aborted') {
        throw new Error(response.errorMessage ?? 'Model Grader failed.');
      }
      const parsed = ResponseSchema.parse(JSON.parse(extractJson(contentText(response.content))));
      const byDimension = new Map(parsed.grades.map((grade) => [grade.dimension, grade]));
      const grades = dimensions.map((dimension) => {
        const grade = byDimension.get(dimension);
        return GraderResultSchema.parse({
          grader: 'model',
          dimension,
          judgement: grade?.judgement ?? 'not_gradable',
          ...(grade?.score !== undefined ? { score: grade.score } : {}),
          rationale: grade?.rationale ?? 'The Grader did not return this required dimension.',
          evidenceRefs: grade?.evidenceRefs ?? [],
          graderModel: `${input.config.providerId}/${input.config.modelId}`,
          promptVersion: MODEL_GRADER_PROMPT_VERSION,
          ruleVersion: MODEL_GRADER_RULE_VERSION,
          gradedAt: request.now,
        });
      });
      return {
        grades,
        usage: {
          modelCalls: 1,
          inputTokens: response.usage?.input ?? 0,
          outputTokens: response.usage?.output ?? 0,
          estimatedCostUsd: response.usage?.cost.total ?? 0,
        },
      };
    },
  };
}

function modelFromConfig(
  config: EvaluationModelConfig,
  baseUrl: string,
  builtin?: Model<Api>,
): Model<Api> {
  return {
    ...(builtin ?? {}),
    id: config.modelId,
    name: config.modelId,
    api: config.api,
    provider: config.providerId,
    baseUrl,
    reasoning: builtin?.reasoning ?? false,
    input: builtin?.input ?? ['text'],
    cost: builtin?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindowTokens,
    maxTokens: config.maxOutputTokens,
  };
}

function apiImplementation(api: Api): ProviderStreams {
  switch (api) {
    case 'openai-completions': return openAICompletionsApi();
    case 'openai-responses': return openAIResponsesApi();
    case 'openai-codex-responses': return openAICodexResponsesApi();
    case 'anthropic-messages': return anthropicMessagesApi();
    case 'google-generative-ai': return googleGenerativeAIApi();
    default: throw new Error(`Unsupported Evaluation Grader API: ${api}.`);
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
  if (fenced) return fenced;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
