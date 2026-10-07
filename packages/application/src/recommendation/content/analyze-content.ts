/*
 * Runs one complete text analysis for one content: the eight business results
 * plus the interest relations the model returns in the same response. The
 * prompt and the response schema live here; the call boundary, usage
 * accounting, and failure classification are shared with the other text tasks.
 */
import { estimateTextTokens } from '@megumi/ai/utils/estimate';
import type { Api, Model } from '@megumi/ai';
import { z } from 'zod';
import type { Observability } from '../../observability/index';
import {
  callTextModel,
  type TextModelCallRecord,
  type TextModelClient,
  type TextModelFailureCode,
} from '../call-text-model';
import {
  ContentAnalysisMatchSchema,
  ContentAnalysisResultSchema,
  type ContentAnalysisMatch,
  type ContentAnalysisResult,
  type KeyPoint,
} from './content-contracts';

const SYSTEM_PROMPT = [
  'You analyze exactly one source document and reply with one JSON object.',
  'Reply with JSON only, shaped exactly like this:',
  '{"summary":"...","keyPoints":[{"text":"...","evidence":"..."}],"topics":["..."],"entities":["..."],"contentType":"article","qualityScore":0.5,"spamScore":0,"longTermValue":"learning","matches":[{"interestId":"...","relation":"direct","basis":"..."}]}',
  'Rules:',
  '- Do not add any other key.',
  '- Use only the supplied document text. Never invent facts, dates, numbers, or quotes.',
  '- The document may be an excerpt or a truncated opening; judge what is present and never assume the rest.',
  '- summary: one paragraph covering the main fact, claim, or method.',
  '- keyPoints: each item has "text" and "evidence"; "evidence" must be a fragment copied from the document text.',
  '- topics: subject areas rather than keywords.',
  '- entities: concrete named things mentioned in the document.',
  '- contentType: one of news, article, discussion, video, paper, project, tutorial, opinion.',
  '- qualityScore: 0..1 for information density, facts, examples, and method detail; it does not mean fit for a reader.',
  '- spamScore: 0..1 for advertising, boilerplate, and title-body mismatch.',
  '- longTermValue: one of none, learning, reference, practical.',
  '- matches: exactly one entry per listed interest, each with "interestId" copied verbatim, "relation" one of direct, related, none, and a short "basis".',
  "- Write text fields in the document's own language.",
].join('\n');

const AnalysisResponseSchema = ContentAnalysisResultSchema.extend({
  matches: z.array(ContentAnalysisMatchSchema),
});

/** One interest as the task read it; the model only judges these ids. */
export interface AnalysisInterest {
  readonly id: string;
  readonly text: string;
  readonly revision: number;
}

export interface AnalyzeContentInput {
  readonly contentId: string;
  readonly text: string;
  readonly title?: string;
  readonly interests: readonly AnalysisInterest[];
  readonly model: Model<Api>;
  /** Per-request input ceiling from the round configuration. */
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly signal?: AbortSignal;
}

export type AnalyzeContentResult =
  | {
      status: 'analyzed';
      analysis: ContentAnalysisResult;
      matches: readonly ContentAnalysisMatch[];
      record: TextModelCallRecord;
    }
  | { status: 'material_too_long'; message: string }
  | { status: 'failed'; code: TextModelFailureCode; message: string };

/** What one request is expected to cost, before anything is sent or charged. */
export interface AnalysisRequestEstimate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** False when the material cannot fit one request, so no call will be made. */
  readonly fits: boolean;
}

/**
 * Estimates one request. The caller reserves budget with this number before it
 * saves material, and this module uses the same number for its own overflow
 * check, so the two never disagree.
 */
export function estimateAnalysisRequest(input: AnalyzeContentInput): AnalysisRequestEstimate {
  const available =
    Math.min(input.maxInputTokens, input.model.contextWindow) - input.maxOutputTokens;
  const inputTokens = estimateTextTokens(`${SYSTEM_PROMPT}\n${buildPrompt(input)}`);
  return {
    inputTokens,
    outputTokens: input.maxOutputTokens,
    fits: inputTokens <= available,
  };
}

/**
 * Analyzes one content and returns the eight business results plus the interest
 * relations. Nothing is saved here: the caller commits the results and the
 * relations in one transaction.
 */
export async function analyzeContent(
  client: TextModelClient,
  input: AnalyzeContentInput,
  options: { observability?: Observability; now?: () => number } = {},
): Promise<AnalyzeContentResult> {
  const estimate = estimateAnalysisRequest(input);
  if (!estimate.fits) {
    return {
      status: 'material_too_long',
      message: 'Material exceeds the configured model input for one analysis request.',
    };
  }
  const prompt = buildPrompt(input);

  const call = await callTextModel(
    client,
    {
      model: input.model,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: AnalysisResponseSchema,
      maxOutputTokens: input.maxOutputTokens,
      ...(input.signal ? { signal: input.signal } : {}),
    },
    options,
  );
  if (call.status === 'failed') {
    return { status: 'failed', code: call.code, message: call.message };
  }

  const { matches, ...analysis } = call.result;
  return {
    status: 'analyzed',
    analysis: {
      ...analysis,
      keyPoints: keepSupportedKeyPoints(analysis.keyPoints, input.text),
    },
    matches: keepKnownInterests(matches, input.interests),
    record: call.record,
  };
}

function buildPrompt(input: AnalyzeContentInput): string {
  // Identifiers are emitted as JSON so an id that contains the display
  // separator can still be copied back verbatim.
  const interestLines = input.interests.map((interest) =>
    JSON.stringify({ interestId: interest.id, text: interest.text }),
  );
  return [
    'Interests (copy interestId verbatim):',
    ...(interestLines.length > 0 ? interestLines.map((line) => `- ${line}`) : ['- (none)']),
    '',
    ...(input.title ? [`Title: ${input.title}`] : []),
    'Document text:',
    input.text,
  ].join('\n');
}

/**
 * Keeps only key points whose evidence appears in the analyzed text. The check
 * cannot prove the model's judgement, but it rejects invented quotations.
 */
function keepSupportedKeyPoints(keyPoints: readonly KeyPoint[], text: string): KeyPoint[] {
  const haystack = foldForEvidence(text);
  return keyPoints.filter((point) => haystack.includes(foldForEvidence(point.evidence)));
}

/** Drops relations for interests the task never asked about. */
function keepKnownInterests(
  matches: readonly ContentAnalysisMatch[],
  interests: readonly AnalysisInterest[],
): ContentAnalysisMatch[] {
  const known = new Set(interests.map((interest) => interest.id));
  return matches.filter((match) => known.has(match.interestId));
}

/** Evidence comparison ignores whitespace and case, not wording. */
function foldForEvidence(value: string): string {
  return value.replace(/\s+/gu, '').toLowerCase();
}
