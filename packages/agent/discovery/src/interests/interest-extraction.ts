/* Builds and executes the provider-neutral model request for one conversation turn. */
import type { Api, Model, Models } from '@megumi/ai';
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
  extract(input: InterestExtractionInput): Promise<InterestExtractionResult>;
}

export function createInterestExtractor(options: {
  readonly models: Pick<Models, 'completeSimple'>;
}): InterestExtractor {
  return {
    async extract(input) {
      const response = await options.models.completeSimple(input.model, {
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
      }, {
        sessionId: `interest-extraction:${input.job.sessionId}`,
        signal: input.signal,
      });
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
