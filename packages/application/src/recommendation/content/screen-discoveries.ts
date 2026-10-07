/*
 * Judges one batch of discoveries for relevance before the expensive complete
 * analysis runs. It reads a batch that already came through normalization and
 * identity deduplication, sends titles and text openings only, and records every
 * dropped discovery as `SCREENED_OUT`. Screening is a cost control, not a quality
 * filter: an uncertain verdict, a failed call, or an exhausted budget keeps the
 * discovery for the full analysis instead of discarding it.
 */
import { estimateTextTokens } from '@megumi/ai/utils/estimate';
import type { Api, Model } from '@megumi/ai';
import { z } from 'zod';
import type { Observability } from '../../observability/index';
import { callTextModel, type TextModelClient, type TextModelFailureCode } from '../call-text-model';
import type { RawItem } from '../sources/source-connector';
import type { AnalysisInterest, AnalysisRequestEstimate } from './analyze-content';
import type { ContentStorage } from './content-storage';
import { normalizeRawItem } from './normalize-content';

/** The error code a screened-out discovery carries in `search_results`. */
export const SCREENED_OUT = 'SCREENED_OUT';

/** How much source text one item shows the model: an opening, never the material. */
const EXCERPT_CHARACTERS = 500;

/**
 * Output one verdict is expected to cost. The model answers with one short JSON
 * object per item, so this is a size guard rather than a predicted answer length.
 */
const DECISION_OUTPUT_TOKENS = 64;

const SYSTEM_PROMPT = [
  'You decide whether each listed source item could matter to any listed interest.',
  'You only receive each item title and the opening of its source text.',
  'Reply with JSON only, shaped exactly like this:',
  '{"decisions":[{"itemId":"...","verdict":"keep"}]}',
  'Rules:',
  '- Do not add any other key.',
  '- Answer with exactly one decision per listed item, copying itemId verbatim.',
  '- verdict is "drop" only when you are certain the item is unrelated to every listed interest;',
  '  when you are not certain, use "keep".',
  '- Judge relevance to an interest only. Quality, spam, and usefulness are not yours to judge.',
  '- The text is an opening and may continue; never assume what the rest says.',
].join('\n');

const ScreeningResponseSchema = z
  .object({
    decisions: z.array(
      z
        .object({
          itemId: z.string().trim().min(1),
          verdict: z.enum(['keep', 'drop']),
        })
        .strict(),
    ),
  })
  .strict();

export interface ScreenDiscoveriesDependencies {
  readonly client: TextModelClient;
  readonly contents: ContentStorage;
  readonly observability?: Observability;
}

/**
 * One discovery as screening reads it: its row id and the source facts. Screening
 * never needs the rest of a stored discovery, so it does not require that type.
 */
export interface ScreenableInput {
  readonly resultId: string;
  readonly item: RawItem;
}

export interface ScreenDiscoveriesInput {
  /** Discoveries this round has not finished, in the order they should be judged. */
  readonly items: readonly ScreenableInput[];
  /** Enabled interests as the task read them; only these ids may be judged. */
  readonly interests: readonly AnalysisInterest[];
  readonly model: Model<Api>;
  /** Configured accepted languages; empty means no restriction. */
  readonly contentLanguages: readonly string[];
  /** Per-request ceilings from the round configuration. */
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  /**
   * Most items one call may carry. A batch comes from one search or one resume
   * batch, so this is the source's single-search limit and never a pool size.
   */
  readonly maxBatchItems: number;
  /**
   * Reserves one screening call, sizing it with `estimateScreeningRequest` for
   * the batch about to be sent. Returning false leaves every remaining discovery
   * pending for a later round; it never lets the round skip screening and run the
   * full analysis instead.
   */
  readonly reserveScreening?: (estimate: AnalysisRequestEstimate) => boolean;
  readonly now: number;
  readonly signal?: AbortSignal;
}

/**
 * One discovery as screening reads it: its row id and the source facts. Screening
 * never needs the rest of a stored discovery, so it does not require that type.
 */
export interface ScreenableInput {
  readonly resultId: string;
  readonly item: RawItem;
}

/** One verdict for one discovery, keyed by the row later stages update. */
export interface ScreeningDecision {
  readonly resultId: string;
  readonly keep: boolean;
}

export type ScreenDiscoveriesOutcome =
  | {
      status: 'screened';
      decisions: readonly ScreeningDecision[];
      /** True when the budget ran out before every discovery was judged. */
      deferred: boolean;
    }
  | { status: 'failed'; code: TextModelFailureCode; message: string };

/**
 * Screens one batch and records what it drops. A refused reservation saves
 * nothing, so the unscreened discoveries stay pending for a later round. A failed
 * call reports the failure and keeps the whole batch.
 */
export async function screenDiscoveries(
  dependencies: ScreenDiscoveriesDependencies,
  input: ScreenDiscoveriesInput,
): Promise<ScreenDiscoveriesOutcome> {
  const decisions: ScreeningDecision[] = [];
  const batches = splitIntoBatches(screenable(dependencies, input), input);
  for (const batch of batches) {
    if (input.reserveScreening && !input.reserveScreening(estimateScreeningRequest(input, batch))) {
      return { status: 'screened', decisions, deferred: true };
    }

    const call = await callTextModel(
      dependencies.client,
      {
        model: input.model,
        systemPrompt: SYSTEM_PROMPT,
        prompt: buildPrompt(input.interests, batch),
        schema: ScreeningResponseSchema,
        maxOutputTokens: decisionOutputTokens(batch.length, input.maxOutputTokens),
        ...(input.signal ? { signal: input.signal } : {}),
      },
      dependencies.observability ? { observability: dependencies.observability } : {},
    );
    if (call.status === 'failed') {
      return { status: 'failed', code: call.code, message: call.message };
    }

    const verdicts = new Map(call.result.decisions.map((entry) => [entry.itemId, entry.verdict]));
    for (const candidate of batch) {
      const keep = verdicts.get(candidate.discovery.resultId) !== 'drop';
      if (!keep) {
        dependencies.contents.markResultRejected({
          resultId: candidate.discovery.resultId,
          errorCode: SCREENED_OUT,
          now: input.now,
        });
      }
      decisions.push({ resultId: candidate.discovery.resultId, keep });
    }
  }

  return { status: 'screened', decisions, deferred: false };
}

/**
 * What one screening request is expected to cost. The caller reserves budget with
 * this number before the request is sent, so a batch is never charged as a whole
 * request ceiling. `estimateScreeningRequest` is the only caller-visible way to
 * size that reservation, so it stays exported next to `screenDiscoveries`.
 */
export function estimateScreeningRequest(
  input: ScreenDiscoveriesInput,
  batch: readonly ScreenableDiscovery[],
): AnalysisRequestEstimate {
  const available =
    Math.min(input.maxInputTokens, input.model.contextWindow) - input.maxOutputTokens;
  const inputTokens = estimateTextTokens(`${SYSTEM_PROMPT}\n${buildPrompt(input.interests, batch)}`);
  return {
    inputTokens,
    outputTokens: decisionOutputTokens(batch.length, input.maxOutputTokens),
    fits: inputTokens <= available,
  };
}

/**
 * One discovery that still needs a verdict: normalized, deduplicated, and
 * unscreened. Batches of these are what `estimateScreeningRequest` sizes.
 */
export interface ScreenableDiscovery {
  readonly discovery: ScreenableInput;
  readonly title?: string;
  /** Opening of the source text; the full material never leaves this module. */
  readonly excerpt: string;
}

/**
 * Keeps the discoveries the model still has to judge. Normalization and identity
 * deduplication run here in the order the full intake uses them, so a discovery
 * the normalizer refuses and a rediscovery of stored content both skip screening:
 * the first has no text to judge and the second is already a content.
 */
function screenable(
  dependencies: ScreenDiscoveriesDependencies,
  input: ScreenDiscoveriesInput,
): ScreenableDiscovery[] {
  const screenableItems: ScreenableDiscovery[] = [];
  for (const discovery of input.items) {
    const normalized = normalizeRawItem(discovery.item, {
      contentLanguages: input.contentLanguages,
    });
    if (normalized.status === 'rejected') continue;
    const { title, text, canonicalUrl } = normalized.content;
    if (dependencies.contents.findByCanonicalUrl(canonicalUrl)) continue;
    screenableItems.push({
      discovery,
      ...(title ? { title } : {}),
      excerpt: text.slice(0, EXCERPT_CHARACTERS),
    });
  }
  return screenableItems;
}

/** Splits by the batch limit, then by the request input, so no batch overflows. */
function splitIntoBatches(
  items: readonly ScreenableDiscovery[],
  input: ScreenDiscoveriesInput,
): ScreenableDiscovery[][] {
  const available = input.maxInputTokens - input.maxOutputTokens;
  const base = estimateTextTokens(SYSTEM_PROMPT);
  const batches: ScreenableDiscovery[][] = [];
  let current: ScreenableDiscovery[] = [];
  let tokens = base;

  const flush = () => {
    if (current.length > 0) batches.push(current);
    current = [];
    tokens = base;
  };
  for (const item of items) {
    const itemTokens = estimateTextTokens(blockOf(item));
    if (
      current.length > 0 &&
      (current.length >= input.maxBatchItems || tokens + itemTokens > available)
    ) {
      flush();
    }
    current.push(item);
    tokens += itemTokens;
  }
  flush();
  return batches;
}

function blockOf(item: ScreenableDiscovery): string {
  return [
    `[itemId=${item.discovery.resultId}]`,
    `title: ${item.title ?? ''}`,
    `textOpening: ${item.excerpt}`,
  ].join('\n');
}

function buildPrompt(
  interests: readonly AnalysisInterest[],
  batch: readonly ScreenableDiscovery[],
): string {
  // Identifiers travel as JSON so an id containing the display separator can be
  // copied back verbatim.
  const interestLines = interests.map((interest) =>
    JSON.stringify({ interestId: interest.id, text: interest.text }),
  );
  return [
    'Interests (copy interestId verbatim):',
    ...(interestLines.length > 0 ? interestLines.map((line) => `- ${line}`) : ['- (none)']),
    '',
    'Items (copy itemId verbatim):',
    ...batch.map(blockOf),
  ].join('\n');
}

/** One short verdict each, capped by the configured output ceiling. */
function decisionOutputTokens(items: number, maxOutputTokens: number): number {
  return Math.min(items * DECISION_OUTPUT_TOKENS, maxOutputTokens);
}
