/*
 * Runs one discovery through normalization, deduplication, analysis, and the
 * first candidate commit. This is the smallest end-to-end intake; search
 * planning and pool evaluation arrive in later batches.
 */
import type { Api, Model } from '@megumi/ai';
import type { Observability } from '../../observability/index';
import type { TextModelClient } from '../call-text-model';
import type { CandidatePool } from '../candidates/candidate-contracts';
import type { CandidateStorage } from '../candidates/candidate-storage';
import type { RawItem } from '../sources/source-connector';
import { analyzeContent, type AnalysisInterest } from './analyze-content';
import type { ContentAnalysis, ContentAnalysisMatch, ContentAnalysisResult } from './content-contracts';
import type { ContentStorage } from './content-storage';
import { normalizeRawItem } from './normalize-content';

export interface IntakeDependencies {
  readonly client: TextModelClient;
  readonly contents: ContentStorage;
  readonly candidates: CandidateStorage;
  /** Identifier minted for a newly stored content. */
  readonly newContentId: () => string;
  readonly observability?: Observability;
}

export interface IntakeInput {
  readonly item: RawItem;
  readonly sourceResultId: string;
  /** Interests to judge, with the description the task read. */
  readonly interests: readonly AnalysisInterest[];
  readonly model: Model<Api>;
  readonly contentLanguages: readonly string[];
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  /** Recent window the daily pool uses; the long-term pool has no date rule. */
  readonly freshnessDays: number;
  readonly now: number;
  readonly signal?: AbortSignal;
}

export type IntakeOutcome =
  | {
      status: 'candidate';
      contentId: string;
      analysis: ContentAnalysisResult;
      /** True when the result came from an existing duplicate's saved analysis. */
      reusedAnalysis: boolean;
      committedPools: readonly CandidatePool[];
    }
  | { status: 'reused'; contentId: string; message: string }
  | { status: 'rejected'; reason: string; message: string }
  | { status: 'failed'; code: string; message: string };

/**
 * Processes one discovery. Material is saved before the model runs, so a later
 * model failure never loses the source facts; the eight results and the
 * interest relations are committed only after they are saved.
 */
export async function intakeContent(
  dependencies: IntakeDependencies,
  input: IntakeInput,
): Promise<IntakeOutcome> {
  const normalized = normalizeRawItem(input.item, { contentLanguages: input.contentLanguages });
  if (normalized.status === 'rejected') {
    return { status: 'rejected', reason: normalized.reason, message: normalized.message };
  }
  const content = normalized.content;

  const existing = dependencies.contents.findByCanonicalUrl(content.canonicalUrl);
  if (existing) {
    return {
      status: 'reused',
      contentId: existing.id,
      message: 'Content already stored for this canonical URL.',
    };
  }

  const contentId = dependencies.newContentId();
  const duplicateOf = dependencies.contents.findIdByExactText({
    text: content.text,
    excludeId: contentId,
  });
  dependencies.contents.saveNormalized({
    content: { id: contentId, ...content },
    sourceResultId: input.sourceResultId,
    sourceUrl: content.canonicalUrl,
    now: input.now,
  });

  const reused =
    duplicateOf === undefined
      ? undefined
      : completeAnalysis(dependencies.contents.readAnalysis(duplicateOf));
  // A reused analysis needs no model call; its relations are inherited later.
  const step: AnalysisStep =
    reused === undefined
      ? await analyze(dependencies, input, contentId, content)
      : { status: 'ok', result: reused, matches: [] };

  if (step.status === 'failed') return step.outcome;

  if (duplicateOf !== undefined) {
    dependencies.contents.recordDuplicate({
      contentId,
      duplicateOfContentId: duplicateOf,
      confidence: 1,
      now: input.now,
    });
  }

  dependencies.contents.saveAnalysisResult({
    contentId,
    result: step.result,
    now: input.now,
  });
  if (reused && duplicateOf) {
    // Equal text means equal relations, so the member inherits them.
    dependencies.candidates.copyRelations({
      fromContentId: duplicateOf,
      toContentId: contentId,
      now: input.now,
    });
  }

  const commit = dependencies.candidates.commitRelations({
    contentId,
    matches: step.matches.map((match) => ({
      interestId: match.interestId,
      expectedText:
        input.interests.find((interest) => interest.id === match.interestId)?.text ?? '',
      relation: match.relation,
      ...(match.basis ? { basis: match.basis } : {}),
    })),
    pools: qualifyingPools({
      ...(content.publishedAt !== undefined ? { publishedAt: content.publishedAt } : {}),
      longTermValue: step.result.longTermValue,
      freshnessDays: input.freshnessDays,
      now: input.now,
    }),
    now: input.now,
  });

  return {
    status: 'candidate',
    contentId,
    analysis: step.result,
    reusedAnalysis: reused !== undefined,
    committedPools: commit.committedPools,
  };
}

type AnalysisStep =
  | { status: 'ok'; result: ContentAnalysisResult; matches: readonly ContentAnalysisMatch[] }
  | { status: 'failed'; outcome: Extract<IntakeOutcome, { status: 'failed' }> };

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * The pools one analyzed content actually qualifies for. The daily pool needs a
 * source-declared publication time inside `[publishedAt, publishedAt +
 * freshnessDays)`; a future date does not take effect early. The long-term pool
 * has no date rule and only excludes content the analysis judged worthless, so
 * an older but valuable document stays available there instead of becoming an
 * already-expired daily relation.
 */
function qualifyingPools(input: {
  readonly publishedAt?: number;
  readonly longTermValue: ContentAnalysisResult['longTermValue'];
  readonly freshnessDays: number;
  readonly now: number;
}): { pool: CandidatePool; expiresAt?: number }[] {
  const pools: { pool: CandidatePool; expiresAt?: number }[] = [];
  if (input.publishedAt !== undefined && input.publishedAt <= input.now) {
    const expiresAt = input.publishedAt + input.freshnessDays * DAY_MS;
    if (input.now < expiresAt) pools.push({ pool: 'daily', expiresAt });
  }
  if (input.longTermValue !== 'none') pools.push({ pool: 'long_term' });
  return pools;
}

async function analyze(
  dependencies: IntakeDependencies,
  input: IntakeInput,
  contentId: string,
  content: { readonly text: string; readonly title?: string },
): Promise<AnalysisStep> {
  const analyzed = await analyzeContent(
    dependencies.client,
    {
      contentId,
      text: content.text,
      ...(content.title ? { title: content.title } : {}),
      interests: input.interests,
      model: input.model,
      maxInputTokens: input.maxInputTokens,
      maxOutputTokens: input.maxOutputTokens,
      ...(input.signal ? { signal: input.signal } : {}),
    },
    dependencies.observability ? { observability: dependencies.observability } : {},
  );

  if (analyzed.status === 'analyzed') {
    return { status: 'ok', result: analyzed.analysis, matches: analyzed.matches };
  }
  return {
    status: 'failed',
    outcome: {
      status: 'failed',
      code: analyzed.status === 'material_too_long' ? 'MATERIAL_TOO_LONG' : analyzed.code,
      message: analyzed.message,
    },
  };
}

/** Returns the eight business results only when a saved analysis is complete. */
function completeAnalysis(analysis: ContentAnalysis | undefined): ContentAnalysisResult | undefined {
  if (
    !analysis ||
    analysis.status !== 'ready' ||
    analysis.summary === undefined ||
    analysis.keyPoints === undefined ||
    analysis.topics === undefined ||
    analysis.entities === undefined ||
    analysis.contentType === undefined ||
    analysis.qualityScore === undefined ||
    analysis.spamScore === undefined ||
    analysis.longTermValue === undefined
  ) {
    return undefined;
  }
  return {
    summary: analysis.summary,
    keyPoints: analysis.keyPoints,
    topics: analysis.topics,
    entities: analysis.entities,
    contentType: analysis.contentType,
    qualityScore: analysis.qualityScore,
    spamScore: analysis.spamScore,
    longTermValue: analysis.longTermValue,
  };
}
