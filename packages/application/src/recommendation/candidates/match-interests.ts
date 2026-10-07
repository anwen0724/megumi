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
  /** How many matching calls this round may still spend. */
  readonly callBudget: number;
  /** Per-request ceilings from the round configuration. */
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  /** Reserves one matching call for the next batch; false stops matching. */
  readonly reserveMatchingCall?: () => boolean;
  readonly now: number;
  readonly signal?: AbortSignal;
}

/** Contents one call is expected to hold before the token split reduces it. */
const CONTENTS_PER_CALL = 25;

export type MatchInterestsOutcome =
  | {
      status: 'ok';
      matchedContents: number;
      savedRelations: number;
      skippedRelations: number;
      /** True when the call budget ran out before every candidate was judged. */
      deferred: boolean;
    }
  | { status: 'failed'; code: TextModelFailureCode; message: string };

/**
 * Re-matches already-analyzed content against the current interests. Batches are
 * split by the configured request input, so one oversized batch can no longer
 * fail the whole re-match, and each call is charged to the round before it runs.
 */
export async function matchPendingInterests(
  dependencies: MatchInterestsDependencies,
  input: MatchInterestsInput,
): Promise<MatchInterestsOutcome> {
  const empty = {
    status: 'ok' as const,
    matchedContents: 0,
    savedRelations: 0,
    skippedRelations: 0,
    deferred: false,
  };
  if (input.interests.length === 0) return empty;

  const contentIds = dependencies.candidates.listContentsMissingMatches({
    limit: Math.max(0, input.callBudget) * CONTENTS_PER_CALL,
  });
  const analyzed = contentIds.flatMap((contentId) => {
    const analysis = dependencies.contents.readAnalysis(contentId);
    return analysis ? [{ contentId, analysis }] : [];
  });
  if (analyzed.length === 0) return empty;

  const batches = splitByRequestInput(analyzed, input);
  const knownInterests = new Map(input.interests.map((interest) => [interest.id, interest]));
  let matchedContents = 0;
  let savedRelations = 0;
  let skippedRelations = 0;
  let deferred = false;

  for (const batch of batches) {
    if (input.reserveMatchingCall && !input.reserveMatchingCall()) {
      deferred = true;
      break;
    }
    const call = await callTextModel(
      dependencies.client,
      {
        model: input.model,
        systemPrompt: SYSTEM_PROMPT,
        prompt: buildPrompt(input.interests, batch),
        schema: MatchResponseSchema,
        maxOutputTokens: input.maxOutputTokens,
        ...(input.signal ? { signal: input.signal } : {}),
      },
      dependencies.observability ? { observability: dependencies.observability } : {},
    );
    if (call.status === 'failed') {
      return { status: 'failed', code: call.code, message: call.message };
    }

    matchedContents += batch.length;
    for (const entry of batch) {
      const matches = call.result.matches
        .filter((match) => match.contentId === entry.contentId && knownInterests.has(match.interestId))
        .map((match) => ({
          interestId: match.interestId,
          expectedText: knownInterests.get(match.interestId)?.text ?? '',
          expectedRevision: knownInterests.get(match.interestId)?.revision ?? 0,
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
  }

  return { status: 'ok', matchedContents, savedRelations, skippedRelations, deferred };
}

/** A content that cannot fit on its own stays in a batch so the overflow is reported. */
function splitByRequestInput(
  analyzed: readonly JudgedContent[],
  input: MatchInterestsInput,
): JudgedContent[][] {
  const available = input.maxInputTokens - input.maxOutputTokens;
  const base = estimateTextTokens(SYSTEM_PROMPT);
  const batches: JudgedContent[][] = [];
  let current: JudgedContent[] = [];
  let tokens = base;
  for (const entry of analyzed) {
    const entryTokens = estimateTextTokens(blockOf(entry));
    if (current.length > 0 && tokens + entryTokens > available) {
      batches.push(current);
      current = [];
      tokens = base;
    }
    current.push(entry);
    tokens += entryTokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

interface JudgedContent {
  readonly contentId: string;
  readonly analysis: ContentAnalysis;
}

/** One content as the model sees it: saved analysis only, never the source text. */
function blockOf(entry: JudgedContent): string {
  return [
    `[contentId=${entry.contentId}]`,
    `summary: ${entry.analysis.summary ?? ''}`,
    `keyPoints: ${(entry.analysis.keyPoints ?? []).map((point) => point.text).join(' | ')}`,
    `topics: ${(entry.analysis.topics ?? []).join(', ')}`,
    `entities: ${(entry.analysis.entities ?? []).join(', ')}`,
  ].join('\n');
}

function buildPrompt(
  interests: readonly AnalysisInterest[],
  analyzed: readonly JudgedContent[],
): string {
  // Identifiers travel as JSON so an id containing the display separator can be
  // copied back verbatim.
  const interestLines = interests.map((interest) =>
    JSON.stringify({ interestId: interest.id, text: interest.text }),
  );
  return [
    'Interests (copy interestId verbatim):',
    ...interestLines.map((line) => `- ${line}`),
    '',
    'Contents:',
    ...analyzed.map(blockOf),
  ].join('\n');
}
