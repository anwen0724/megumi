/*
 * Builds and executes the provider-neutral Interest extraction request for one conversation turn.
 */
import type { Api, Context, Model, Models } from '@megumi/ai';
import type { Observability, OperationCompletion, TraceCorrelation } from '@megumi/observability';
import {
  InterestExtractionResultSchema,
  type Interest,
  type InterestEvidence,
  type InterestExtractionResult,
} from './interest';
import type { InterestExtractionJob } from './interest-extraction-queue';

export interface InterestExtractionInput {
  readonly job: InterestExtractionJob;
  readonly userText: string;
  readonly assistantText: string;
  readonly interests: readonly Interest[];
  readonly pendingEvidence: readonly InterestEvidence[];
  readonly model: Model<Api>;
  readonly signal: AbortSignal;
}

export interface InterestExtractor {
  /** Extracts validated Evidence and Interest effects from one completed conversation turn. */
  extract(input: InterestExtractionInput): Promise<InterestExtractionResult>;
}

/** Creates the provider-neutral extractor for one completed conversation turn. */
export function createInterestExtractor(options: {
  readonly models: Pick<Models, 'completeSimple'>;
  readonly observability?: Observability;
}): InterestExtractor {
  return {
    async extract(input) {
      const context: Context = {
        systemPrompt: systemPrompt,
        messages: [{
          role: 'user',
          content: JSON.stringify({
            userMessage: input.userText,
            assistantReplyForReferenceOnly: input.assistantText,
            existingInterests: input.interests,
            pendingMediumEvidence: input.pendingEvidence,
          }),
          timestamp: Date.parse(input.job.completedAt),
        }],
      };
      const correlation = interestCorrelation(input.job);
      safeRecord(options.observability, 'interest.understanding.input', {
        userMessage: input.userText,
        assistantReplyForReferenceOnly: input.assistantText,
        existingInterests: input.interests,
        pendingMediumEvidence: input.pendingEvidence,
      }, correlation);
      safeRecord(options.observability, 'model.request', {
        model: { providerId: input.model.provider, modelId: input.model.id },
        context,
      }, correlation);
      const response = await observeModelCall(options.observability, correlation, () => (
        options.models.completeSimple(input.model, context, {
          sessionId: `interest-extraction:${input.job.sessionId}`,
          signal: input.signal,
        })
      ));
      safeRecord(options.observability, 'model.response', response, correlation);
      if (response.stopReason === 'error' || response.stopReason === 'aborted') {
        throw new Error(response.errorMessage ?? 'Interest extraction failed.');
      }
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
      return InterestExtractionResultSchema.parse(JSON.parse(stripCodeFence(text)));
    },
  };
}

async function observeModelCall<T>(
  observability: Observability | undefined,
  correlation: TraceCorrelation,
  operation: () => Promise<T>,
): Promise<T> {
  let promise: Promise<T> | undefined;
  const runOnce = () => (promise ??= operation());
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name: 'model.call',
      correlation,
      classifyResult: (): OperationCompletion => ({ outcome: { status: 'ok' } }),
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function safeRecord(
  observability: Observability | undefined,
  kind: 'interest.understanding.input' | 'model.request' | 'model.response',
  value: unknown,
  correlation: TraceCorrelation,
): void {
  try {
    observability?.recordContent({ kind, value, correlation });
  } catch {
    // Content capture cannot alter model execution or validation.
  }
}

function interestCorrelation(job: InterestExtractionJob): TraceCorrelation {
  return {
    executionId: job.executionId,
    sessionId: job.sessionId,
    messageId: job.userMessageId,
    userMessageId: job.userMessageId,
    assistantMessageId: job.assistantMessageId,
  };
}

const systemPrompt = `You identify durable content interests expressed by the user in one completed conversation turn.

Return JSON only: {"evidence":[{"description":"...","effect":"support|reject","confidence":"high|medium|low","matchedInterestId":"optional","supportingEvidenceIds":["optional"]}]}.

Rules:
- Evidence belongs only to the user message. The assistant reply is reference for resolving pronouns, never evidence.
- A description must independently say what the user wants to keep following or stop following.
- high means an explicit durable preference; medium means an implicit signal; low means a normal mention or one-off task.
- Reference only Interest and Evidence IDs present in the input.
- For a second independent medium signal with the same meaning, cite the prior pending Evidence ID.
- Do not infer personality, values, or unrelated interests.`;

function stripCodeFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match?.[1] ?? value;
}
