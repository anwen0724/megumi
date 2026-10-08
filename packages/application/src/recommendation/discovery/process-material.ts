/*
 * Advances acquired material through independent understanding and current-interest matching.
 */
import { z } from 'zod';
import { estimateTextTokens } from '@megumi/ai/utils/estimate';
import type { Api, Model } from '@megumi/ai';
import type { RecommendationConfiguration } from '../../settings/definitions/recommendation';
import type { InterestSnapshotEntry } from '../interests/interest-contracts';
import type { CandidateQualificationStorage } from '../candidates/candidate-qualification-storage';
import {
  MaterialAnalysisSchema,
  EvidenceSchema,
  type ContentMaterial,
  type MaterialAnalysis,
  type DiscoveryAttempt,
} from '../content/material-contracts';
import { createMaterialStorage, validateEvidence } from '../content/material-storage';
import type { TextModelClient } from '../call-text-model';
import type { DiscoveryBudget } from './discovery-budget';
import type { SourceQueue } from './source-queue';
import { judgeItems } from './judge-items';
import type { DiscoveryIssue } from './discovery-storage';

export interface MaterialProcessing {
  materials: ReturnType<typeof createMaterialStorage>;
  candidates: CandidateQualificationStorage;
  client: TextModelClient;
  model: Model<Api>;
  config: RecommendationConfiguration;
  budget: DiscoveryBudget;
  modelQueue: SourceQueue;
  runId: string;
  signal: AbortSignal;
  now(): number;
  currentInterests(): Promise<readonly InterestSnapshotEntry[]>;
  priority: number;
  issues: DiscoveryIssue[];
}

/** Processes every text segment before publishing analysis; failed segments never yield a ready analysis. */
export async function processMaterial(
  material: ContentMaterial,
  input: MaterialProcessing,
): Promise<void> {
  const { materials, candidates, now, signal } = input;
  let analysis = materials.readAnalysis(material.contentId, material.id);
  if (!analysis) {
    if (!input.budget.remaining('analysisCalls') || input.budget.expired() || signal.aborted)
      return;

    let attempt: DiscoveryAttempt | undefined;
    let errorCode: string | undefined;
    try {
      const segments = splitMaterial(
        material.text,
        Math.max(
          128,
          Math.min(
            input.config.limits.maxRequestInputTokens,
            input.model.contextWindow - input.config.limits.maxRequestOutputTokens,
          ) - 1500,
        ),
      );
      const analyses: MaterialAnalysis[] = [];
      for (let index = 0; index < segments.length; index++) {
        let calls = 0;
        const outcomes = await judgeItems({
          stage: 'analysis',
          instructions:
            'Analyze only the supplied acquired material. Return summary, keyPoints [{text,evidence:[{materialId,quote}]}], topics, contentType (news/article/discussion/video/paper/project/tutorial/opinion), qualityScore and spamScore (0..1), timeScope {kind:current/durable/unknown,deadline?:UTC milliseconds,evidence:[]}. Quote exact text. Do not assess personal interest or long-term reading value.',
          items: [
            {
              id: material.id,
              data: {
                contentId: material.contentId,
                materialId: material.id,
                text: segments[index],
                title: material.title,
                kind: material.kind,
                truncated: material.truncated,
                segment: index,
                segmentCount: segments.length,
              },
            },
          ],

          validate(_id, value) {
            const parsed = MaterialAnalysisSchema.parse(value);
            validateEvidence(material, [
              ...parsed.keyPoints.flatMap(p => p.evidence),
              ...parsed.timeScope.evidence,
            ]);
            return parsed;
          },

          client: input.client,
          model: input.model,
          budget: input.budget,
          queue: input.modelQueue,
          signal,
          priority: input.priority,

          beforeRequest() {
            if (!attempt)
              attempt = materials.claimAnalysis({
                contentId: material.contentId,
                materialId: material.id,
                runId: input.runId,
                now: now(),
                deadlineAt: Math.min(
                  input.budget.deadlineAt,
                  now() + input.config.limits.requestTimeoutSeconds * 1000,
                ),
              });
            if (!attempt) return false;
            if (
              !materials.renewAnalysis(
                material.contentId,
                material.id,
                attempt,
                now(),
                Math.min(
                  input.budget.deadlineAt,
                  now() + input.config.limits.requestTimeoutSeconds * 1000,
                ),
              )
            )
              return false;
            if (calls++ > 0)
              return materials.retryAnalysis(material.contentId, material.id, attempt, now());

            return true;
          },

          onIssue(code, message) {
            input.issues.push({
              code,
              message,
              subjectId: material.contentId,
            });
          },
        });
        const outcome = outcomes[0]!;
        if (outcome.status === 'failed') {
          errorCode = outcome.code;
          break;
        }

        analyses.push(outcome.result);
      }

      if (attempt && !errorCode && analyses.length === segments.length && !signal.aborted) {
        analysis = mergeAnalyses(analyses);
        if (
          materials.saveAnalysis({
            contentId: material.contentId,
            materialId: material.id,
            result: analysis,
            now: now(),
            attempt,
          }).status !== 'saved'
        )
          analysis = undefined;
      }
    } finally {
      if (attempt)
        materials.releaseAnalysis({
          contentId: material.contentId,
          materialId: material.id,
          attempt,
          now: now(),
          ...(errorCode && errorCode !== 'INPUT_CLAIMED' ? { errorCode } : {}),
        });
    }

    if (errorCode)
      input.issues.push({
        code: errorCode,
        message: 'Material analysis did not complete.',
        subjectId: material.contentId,
      });
  }
  if (!analysis || signal.aborted) return;

  const interests = (await input.currentInterests()).filter(i => i.enabled);
  const schema = z
    .object({
      relation: z.enum(['direct', 'related', 'none']),
      status: z.enum(['eligible', 'rejected']),
      basis: z.string().min(1),
      evidence: z.array(EvidenceSchema),
    })
    .strict();
  for (const interest of interests) {
    if (signal.aborted || input.budget.expired() || !input.budget.remaining('matchingCalls')) break;

    let attempt: DiscoveryAttempt | undefined;
    let calls = 0;
    const outcome = (
      await judgeItems({
        stage: 'matching',
        instructions:
          "Match the user's authoritative interest text to the supplied material and its independent analysis. Return relation direct/related/none, status eligible/rejected, basis, evidence [{materialId,quote}]. Eligible requires a non-none relation and at least one exact quote. Do not require enduring value; curated reading value is a later decision.",
        items: [
          {
            id: interest.id,
            data: {
              contentId: material.contentId,
              materialId: material.id,
              text: analysis.keyPoints
                .flatMap(point => point.evidence.map(evidence => evidence.quote))
                .join('\n'),
              materialScope: 'analysis_evidence',
              interestId: interest.id,
              interestRevision: interest.revision,
              interest: interest.text,
              analysis,
            },
          },
        ],

        validate(_id, value) {
          const result = schema.parse(value);
          validateEvidence(material, result.evidence);
          if (
            result.status === 'eligible' &&
            (result.relation === 'none' || !result.evidence.length)
          )
            throw new Error('Eligible matching requires quoted positive relevance.');

          return result;
        },

        client: input.client,
        model: input.model,
        budget: input.budget,
        queue: input.modelQueue,
        signal,
        priority: input.priority,

        beforeRequest() {
          if (!attempt)
            attempt = candidates.claimMatching({
              contentId: material.contentId,
              materialId: material.id,
              interestId: interest.id,
              interestRevision: interest.revision,
              runId: input.runId,
              now: now(),
              deadlineAt: Math.min(
                input.budget.deadlineAt,
                now() + input.config.limits.requestTimeoutSeconds * 1000,
              ),
            });
          if (!attempt) return false;
          if (calls++ > 0)
            return candidates.retryMatching(material.contentId, interest.id, attempt, now());

          return true;
        },

        onSuccess(_id, result) {
          if (!attempt) return;

          const expiry = analysis!.timeScope.deadline;
          candidates.saveQualification(
            {
              ...result,
              ...(expiry !== undefined && expiry <= now()
                ? {
                    status: 'rejected' as const,
                    relation: 'none' as const,
                    basis: 'Material is no longer current.',
                  }
                : {}),
              contentId: material.contentId,
              materialId: material.id,
              interestId: interest.id,
              interestRevision: interest.revision,
              reviewedAt: now(),
              validUntil:
                expiry !== undefined && expiry > now()
                  ? Math.min(
                      now() + input.config.candidateSupply.reviewAfterDays * 86400000,
                      expiry,
                    )
                  : now() + input.config.candidateSupply.reviewAfterDays * 86400000,
            },
            attempt,
          );
        },

        onIssue(code, message) {
          input.issues.push({
            code,
            message,
            subjectId: material.contentId,
          });
        },
      })
    )[0]!;
    const errorCode = outcome.status === 'failed' ? outcome.code : undefined;
    if (attempt)
      candidates.releaseMatching(
        material.contentId,
        interest.id,
        attempt,
        now(),
        errorCode === 'INPUT_CLAIMED' ? undefined : errorCode,
      );
    if (errorCode)
      input.issues.push({
        code: errorCode,
        message: 'Interest matching did not complete.',
        subjectId: material.contentId,
      });
  }
}

/** Keeps all source text; boundaries prefer paragraphs, then split an oversized paragraph. */
function splitMaterial(text: string, tokens: number): readonly string[] {
  const segments: string[] = [];
  let current = '';
  const cost = (value: string) => estimateTextTokens(JSON.stringify(value));
  for (const paragraph of text.split(/(?<=\n)/)) {
    let remaining = paragraph;
    while (remaining) {
      if (cost(current + remaining) <= tokens) {
        current += remaining;
        break;
      }
      if (current) {
        segments.push(current);
        current = '';
        continue;
      }

      let low = 1;
      let high = remaining.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (cost(remaining.slice(0, middle)) <= tokens) low = middle;
        else high = middle - 1;
      }

      segments.push(remaining.slice(0, low));
      remaining = remaining.slice(low);
    }
  }

  if (current) segments.push(current);

  return segments;
}

/** A combined analysis keeps evidence from every successfully analyzed segment. */
function mergeAnalyses(parts: readonly MaterialAnalysis[]): MaterialAnalysis {
  const deadlines = parts.flatMap(p =>
    p.timeScope.deadline === undefined ? [] : [p.timeScope.deadline],
  );
  return {
    ...parts[0]!,
    summary: parts.map(p => p.summary).join('\n'),
    keyPoints: parts.flatMap(p => p.keyPoints),
    topics: [...new Set(parts.flatMap(p => p.topics))],
    qualityScore: Math.min(...parts.map(p => p.qualityScore)),
    spamScore: Math.max(...parts.map(p => p.spamScore)),
    timeScope: {
      kind: parts.some(p => p.timeScope.kind === 'current')
        ? 'current'
        : parts.every(p => p.timeScope.kind === 'durable')
          ? 'durable'
          : 'unknown',
      ...(deadlines.length ? { deadline: Math.min(...deadlines) } : {}),
      evidence: parts.flatMap(p => p.timeScope.evidence),
    },
  };
}
