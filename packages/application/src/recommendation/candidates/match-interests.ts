/*
 * Judges interests for content that already has a saved analysis. Only the
 * saved summary, key points, topics, and entities are sent, never the source
 * text, and the caller bounds the batch by model input and round budget.
 */
import { estimateTextTokens } from '@megumi/ai/utils/estimate';
import type { Api, Model } from '@megumi/ai';
import { z } from 'zod';
import type { Observability } from '../../observability/index';
import { callTextModel, type TextModelClient, type TextModelFailureCode } from '../call-text-model';
import { InterestRelationSchema, type ContentAnalysis } from '../content/content-contracts';
import type { ContentStorage } from '../content/content-storage';
import type { AnalysisInterest } from '../content/analyze-content';
import type { CandidateStorage } from './candidate-storage';

const SYSTEM_PROMPT = [
  'You judge how each listed interest relates to each listed content.',
  'You only receive saved analysis, never the source document.',
  'Rules:',
  '- Use only the supplied summary, key points, topics, and entities.',
  '- relation is "direct" when the content is about the interest, "related" when it shares a subject or method, and "none" otherwise.',
  '- basis is a short reason; it is not a recommendation reason.',
  '- Judge every listed content against every listed interest.',
  '- Reply with JSON only: {"matches":[{"contentId":"...","interestId":"...","relation":"...","basis":"..."}]}.',
].join('\n');

const MatchResponseSchema = z
  .object({
    matches: z.array(
      z
        .object({
          contentId: z.string().trim().min(1),
          interestId: z.string().trim().min(1),
          relation: InterestRelationSchema,
          basis: z.string().trim().min(1).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export interface MatchInterestsDependencies {
  readonly client: TextModelClient;
  readonly contents: ContentStorage;
  readonly candidates: CandidateStorage;
  readonly observability?: Observability;
}

export interface MatchInterestsInput {
  /** Enabled interests as the task read them. */
  readonly interests: readonly AnalysisInterest[];
  readonly model: Model<Api>;
  readonly batchSize: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly now: number;
  readonly signal?: AbortSignal;
}

export type MatchInterestsOutcome =
  | { status: 'ok'; matchedContents: number; savedRelations: number; skippedRelations: number }
  | { status: 'failed'; code: TextModelFailureCode; message: string };

/**
 * Re-matches one batch of already-analyzed content. Relations judged against a
 * description that changed in the meantime are skipped inside the commit, and a
 * saved `none` keeps the next round from judging the same pair again.
 */
export async function matchPendingInterests(
  dependencies: MatchInterestsDependencies,
  input: MatchInterestsInput,
): Promise<MatchInterestsOutcome> {
  if (input.interests.length === 0) {
    return { status: 'ok', matchedContents: 0, savedRelations: 0, skippedRelations: 0 };
  }

  const contentIds = dependencies.candidates.listContentsMissingMatches({
    limit: input.batchSize,
  });
  if (contentIds.length === 0) {
    return { status: 'ok', matchedContents: 0, savedRelations: 0, skippedRelations: 0 };
  }

  const analyzed = contentIds.flatMap((contentId) => {
    const analysis = dependencies.contents.readAnalysis(contentId);
    return analysis ? [{ contentId, analysis }] : [];
  });
  if (analyzed.length === 0) {
    return { status: 'ok', matchedContents: 0, savedRelations: 0, skippedRelations: 0 };
  }

  const prompt = buildPrompt(input.interests, analyzed);
  if (estimateTextTokens(`${SYSTEM_PROMPT}\n${prompt}`) > input.maxInputTokens - input.maxOutputTokens) {
    return { status: 'failed', code: 'CONTEXT_OVERFLOW', message: 'Matching batch exceeds the configured model input.' };
  }

  const call = await callTextModel(
    dependencies.client,
    {
      model: input.model,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: MatchResponseSchema,
      maxOutputTokens: input.maxOutputTokens,
      ...(input.signal ? { signal: input.signal } : {}),
    },
    dependencies.observability ? { observability: dependencies.observability } : {},
  );
  if (call.status === 'failed') {
    return { status: 'failed', code: call.code, message: call.message };
  }

  const knownInterests = new Map(input.interests.map((interest) => [interest.id, interest.text]));
  let savedRelations = 0;
  let skippedRelations = 0;

  for (const entry of analyzed) {
    const matches = call.result.matches
      .filter((match) => match.contentId === entry.contentId && knownInterests.has(match.interestId))
      .map((match) => ({
        interestId: match.interestId,
        expectedText: knownInterests.get(match.interestId) ?? '',
        relation: match.relation,
        ...(match.basis ? { basis: match.basis } : {}),
      }));
    if (matches.length === 0) continue;

    const commit = dependencies.candidates.commitRelations({
      contentId: entry.contentId,
      matches,
      pools: [],
      now: input.now,
    });
    savedRelations += commit.committedInterestIds.length;
    skippedRelations += commit.skippedInterestIds.length;
  }

  return {
    status: 'ok',
    matchedContents: analyzed.length,
    savedRelations,
    skippedRelations,
  };
}

function buildPrompt(
  interests: readonly AnalysisInterest[],
  analyzed: readonly { readonly contentId: string; readonly analysis: ContentAnalysis }[],
): string {
  const interestLines = interests.map((interest) => `- ${interest.id}: ${interest.text}`);
  const contentBlocks = analyzed.map((entry) =>
    [
      `[contentId=${entry.contentId}]`,
      `summary: ${entry.analysis.summary ?? ''}`,
      `keyPoints: ${(entry.analysis.keyPoints ?? []).map((point) => point.text).join(' | ')}`,
      `topics: ${(entry.analysis.topics ?? []).join(', ')}`,
      `entities: ${(entry.analysis.entities ?? []).join(', ')}`,
    ].join('\n'),
  );

  return ['Interests:', ...interestLines, '', 'Contents:', ...contentBlocks].join('\n');
}
