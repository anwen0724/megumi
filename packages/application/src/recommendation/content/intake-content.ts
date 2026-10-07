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
import { qualifyingPools } from '../candidates/evaluate-candidates';
import type { RawItem } from '../sources/source-connector';
import {
  analyzeContent,
  estimateAnalysisRequest,
  type AnalysisInterest,
  type AnalysisRequestEstimate,
  type AnalyzeContentInput,
} from './analyze-content';
import type { ContentAnalysis, ContentAnalysisMatch, ContentAnalysisResult } from './content-contracts';
import type { ContentStorage } from './content-storage';
import type { MaterialInput } from './material-contracts';
import { identifyContentUrl } from '../sources/source-material';
import { normalizeRawItem } from './normalize-content';
import { SCREENED_OUT } from './screen-discoveries';

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
  /**
   * Decides when a failed analysis may be retried. The round owns that policy;
   * `undefined` makes the failure terminal, which is right for material another
   * attempt would read unchanged.
   */
  readonly analysisRetryAt?: (failureCode: string) => number | undefined;
  /**
   * Reserves one complete-analysis call with its estimated size. Returning false
   * defers the discovery to a later round instead of spending the round on it.
   */
  readonly reserveAnalysis?: (estimate: AnalysisRequestEstimate) => boolean;
  /**
   * Set when relevance screening already judged this discovery unrelated to every
   * current interest. It is recorded as rejected here and never analyzed.
   */
  readonly screenedOut?: boolean;
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
  | { status: 'deferred' }
  | { status: 'failed'; contentId: string; code: string; message: string };

/**
 * Processes one discovery. Material is saved before the model runs, so a later
 * model failure never loses the source facts; the eight results and the
 * interest relations are committed only after they are saved. Every discovery
 * also leaves its discovery row in a recorded state, so no item stays pending.
 */
export async function intakeContent(
  dependencies: IntakeDependencies,
  input: IntakeInput,
): Promise<IntakeOutcome> {
  const normalized = normalizeRawItem(input.item, { contentLanguages: input.contentLanguages });
  if (normalized.status === 'rejected') {
    dependencies.contents.markResultRejected({
      resultId: input.sourceResultId,
      errorCode: normalized.reason,
      now: input.now,
    });
    return { status: 'rejected', reason: normalized.reason, message: normalized.message };
  }
  const content = normalized.content;

  // Relevance screening already judged this discovery against every current
  // interest, so it is finished work: recorded, never stored and never analyzed.
  if (input.screenedOut) {
    dependencies.contents.markResultRejected({
      resultId: input.sourceResultId,
      errorCode: SCREENED_OUT,
      now: input.now,
    });
    return {
      status: 'rejected',
      reason: SCREENED_OUT,
      message: 'Relevance screening found no current interest related to this item.',
    };
  }

  const material = acquiredMaterial(input.item, content, input.now);
  const existing = dependencies.contents.findByCanonicalUrl(content.canonicalUrl);
  if (existing) {
    if (material) dependencies.contents.recordMaterial(material);
    dependencies.contents.markResultReused({
      resultId: input.sourceResultId,
      contentId: existing.id,
      url: content.canonicalUrl,
      now: input.now,
    });
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
  const reused =
    duplicateOf === undefined
      ? undefined
      : completeAnalysis(dependencies.contents.readAnalysis(duplicateOf));

  // Only a complete analysis needs the model, so the budget is charged here and
  // never for a reuse or a rejection. A refused reservation saves nothing, which
  // leaves the discovery pending for a later round.
  const request = analysisRequest(input, contentId, content);
  if (reused === undefined) {
    const estimate = estimateAnalysisRequest(request);
    if (estimate.fits && input.reserveAnalysis && !input.reserveAnalysis(estimate)) {
      return { status: 'deferred' };
    }
  }

  dependencies.contents.saveNormalized({
    ...(material ? { acquiredMaterial: material } : {}),
    content: { id: contentId, ...content },
    sourceResultId: input.sourceResultId,
    sourceUrl: content.canonicalUrl,
    now: input.now,
  });

  // A reused analysis needs no model call; its relations are inherited later.
  const step: AnalysisStep =
    reused === undefined
      ? await analyze(dependencies, request)
      : { status: 'ok', result: reused, matches: [] };

  if (step.status === 'failed') {
    // A first failure must be recorded, or the analysis stays pending forever.
    const retryAt = input.analysisRetryAt?.(step.outcome.code);
    dependencies.contents.markAnalysisFailure({
      contentId,
      ...(retryAt !== undefined ? { retryAt } : {}),
      errorCode: step.outcome.code,
    });
    return step.outcome;
  }

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
      expectedRevision: input.interests.find((interest) => interest.id === match.interestId)?.revision ?? 0,
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

/** One complete-analysis request, built before anything is saved or charged. */
function analysisRequest(
  input: IntakeInput,
  contentId: string,
  content: { readonly text: string; readonly title?: string },
): AnalyzeContentInput {
  return {
    contentId,
    text: content.text,
    ...(content.title ? { title: content.title } : {}),
    interests: input.interests,
    model: input.model,
    maxInputTokens: input.maxInputTokens,
    maxOutputTokens: input.maxOutputTokens,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

async function analyze(
  dependencies: IntakeDependencies,
  request: AnalyzeContentInput,
): Promise<AnalysisStep> {
  const analyzed = await analyzeContent(
    dependencies.client,
    request,
    dependencies.observability ? { observability: dependencies.observability } : {},
  );

  if (analyzed.status === 'analyzed') {
    return { status: 'ok', result: analyzed.analysis, matches: analyzed.matches };
  }
  return {
    status: 'failed',
    outcome: {
      status: 'failed',
      contentId: request.contentId,
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

/** Carries acquired facts through normalization without claiming more text than was received. */
function acquiredMaterial(item: RawItem, content: { canonicalUrl: string; text: string; title?: string; author?: string; language?: string }, now: number): MaterialInput | undefined {
  if (!item.kind || !item.method) return undefined;
  const identity = identifyContentUrl(content.canonicalUrl);
  const start = item.rangeStart ?? 0;
  return {
    platform: item.platform ?? identity?.platform ?? 'web',
    externalId: item.externalId ?? identity?.externalId,
    canonicalUrl: content.canonicalUrl,
    title: content.title,
    author: content.author,
    authorId: item.authorId,
    language: content.language,
    text: content.text,
    kind: item.kind,
    method: item.method,
    truncated: item.truncated ?? false,
    rangeStart: start,
    rangeEnd: start + [...content.text].length,
    acquiredAt: item.acquiredAt ?? now,
    publicationEvidence: [...(item.publicationEvidence ?? [])],
  };
}
