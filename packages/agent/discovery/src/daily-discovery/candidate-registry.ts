/*
 * Keeps normalized Discovery candidates private to one daily Agent execution.
 */
import {
  SourceContentDetailSchema,
  SourceContentSchema,
  type SourceContent,
  type SourceContentDetail,
} from '../sources/discovery-source';
import { canonicalContentIdentity, sourceContentIdentity } from '../candidate-supply/content-identity';

export type DiscoveryCandidate = SourceContent & {
  readonly candidateId: string;
  readonly detail?: SourceContentDetail;
};

export interface CandidateRegistry {
  /** Validates, deduplicates, and merges normalized Source results. */
  add(contents: readonly SourceContent[], admission?: CandidateAdmission): readonly DiscoveryCandidate[];
  /** Reads one candidate by its execution-local id. */
  get(candidateId: string): DiscoveryCandidate | undefined;
  /** Lists current candidates in insertion order. */
  list(): readonly DiscoveryCandidate[];
  /** Validates and attaches detail content to the matching candidate. */
  attachDetail(candidateId: string, detail: SourceContentDetail): DiscoveryCandidate;
  /** Invalidates the registry and releases all execution-scoped candidates. */
  dispose(): void;
}

/** One attempt-local Candidate admission fact emitted after deterministic evaluation. */
export interface CandidateDecision {
  readonly candidateId: string;
  readonly decision: 'accepted' | 'rejected' | 'deduplicated' | 'updated';
  readonly reasonCode?: string;
}

/** Deterministic admission rules applied before identity merging. */
export interface CandidateAdmission {
  readonly reject?: (content: SourceContent) => string | undefined;
  readonly limit?: number;
  readonly limitReasonCode?: string;
}

/** Creates the execution-scoped registry that deduplicates and merges Source candidates. */
export function createCandidateRegistry(options: {
  readonly onDecision?: (decision: CandidateDecision) => void;
} = {}): CandidateRegistry {
  const candidates = new Map<string, DiscoveryCandidate>();
  const candidateIdsByIdentity = new Map<string, string>();
  const candidateIdsBySourceIdentity = new Map<string, string>();
  let nextId = 1;
  let nextRejectedId = 1;
  let disposed = false;

  const assertActive = () => {
    if (disposed) throw new Error('Candidate registry has been disposed.');
  };

  return {
    add(contents, admission = {}) {
      assertActive();
      const inserted: DiscoveryCandidate[] = [];
      const admitted: SourceContent[] = [];
      for (const input of contents) {
        const content = SourceContentSchema.parse(input);
        const rejection = admission.reject?.(content);
        if (rejection) {
          notifyDecision(options.onDecision, {
            candidateId: `candidate:rejected:${nextRejectedId++}`,
            decision: 'rejected',
            reasonCode: rejection,
          });
          continue;
        }
        admitted.push(content);
      }
      const limit = Math.max(0, Math.floor(admission.limit ?? admitted.length));
      for (const _content of admitted.slice(limit)) {
        notifyDecision(options.onDecision, {
          candidateId: `candidate:rejected:${nextRejectedId++}`,
          decision: 'rejected',
          reasonCode: admission.limitReasonCode ?? 'candidate_limit_exceeded',
        });
      }
      for (const content of admitted.slice(0, limit)) {
        const identity = discoveryContentIdentity(content);
        const sourceIdentity = sourceContentIdentity(content);
        const existingId = candidateIdsByIdentity.get(identity)
          ?? candidateIdsBySourceIdentity.get(sourceIdentity);
        if (existingId) {
          const existing = candidates.get(existingId);
          if (!existing) throw new Error(`Candidate identity points to an unknown candidate: ${existingId}.`);
          const merged = mergeContent(existing, content);
          candidates.set(existingId, merged);
          candidateIdsByIdentity.set(identity, existingId);
          candidateIdsBySourceIdentity.set(sourceIdentity, existingId);
          notifyDecision(options.onDecision, {
            candidateId: existingId,
            decision: candidateChanged(existing, merged) ? 'updated' : 'deduplicated',
            reasonCode: identity === discoveryContentIdentity(existing)
              ? 'canonical_identity'
              : 'source_identity',
          });
          continue;
        }
        const candidateId = `candidate:${nextId++}`;
        const candidate = { candidateId, ...content };
        candidateIdsByIdentity.set(identity, candidateId);
        candidateIdsBySourceIdentity.set(sourceIdentity, candidateId);
        candidates.set(candidateId, candidate);
        inserted.push(candidate);
        notifyDecision(options.onDecision, { candidateId, decision: 'accepted' });
      }
      return inserted;
    },
    get(candidateId) {
      assertActive();
      return candidates.get(candidateId);
    },
    list() {
      assertActive();
      return [...candidates.values()];
    },
    attachDetail(candidateId, input) {
      assertActive();
      const current = candidates.get(candidateId);
      if (!current) throw new Error(`Unknown candidate: ${candidateId}.`);
      const detail = SourceContentDetailSchema.parse(input);
      if (current.sourceId !== detail.sourceId
        || (current.sourceContentId && current.sourceContentId !== detail.sourceContentId)) {
        throw new Error('Candidate detail identity does not match the candidate.');
      }
      const updated = { ...current, detail };
      candidates.set(candidateId, updated);
      return updated;
    },
    dispose() {
      candidates.clear();
      candidateIdsByIdentity.clear();
      candidateIdsBySourceIdentity.clear();
      nextRejectedId = 1;
      disposed = true;
    },
  };
}

/** Resolves the strongest available identity for one normalized Source result. */
export function discoveryContentIdentity(content: SourceContent): string {
  return canonicalContentIdentity(content);
}

function notifyDecision(
  observer: ((decision: CandidateDecision) => void) | undefined,
  decision: CandidateDecision,
): void {
  try {
    observer?.(decision);
  } catch {
    // Candidate admission remains authoritative when diagnostics are unavailable.
  }
}

function candidateChanged(current: DiscoveryCandidate, next: DiscoveryCandidate): boolean {
  return current.sourceId !== next.sourceId
    || current.sourceName !== next.sourceName
    || current.sourceContentId !== next.sourceContentId
    || current.canonicalUrl !== next.canonicalUrl
    || current.contentType !== next.contentType
    || current.title !== next.title
    || current.author !== next.author
    || current.publishedAt !== next.publishedAt
    || current.description !== next.description
    || current.coverUrl !== next.coverUrl;
}

function mergeContent(current: DiscoveryCandidate, incoming: SourceContent): DiscoveryCandidate {
  if (sourcePriority(incoming.sourceId) > sourcePriority(current.sourceId)) {
    return {
      candidateId: current.candidateId,
      ...incoming,
      ...(!incoming.author && current.author ? { author: current.author } : {}),
      ...(!incoming.publishedAt && current.publishedAt ? { publishedAt: current.publishedAt } : {}),
      ...(!incoming.description && current.description ? { description: current.description } : {}),
      ...(!incoming.coverUrl && current.coverUrl ? { coverUrl: current.coverUrl } : {}),
    };
  }
  return {
    ...current,
    ...(!current.author && incoming.author ? { author: incoming.author } : {}),
    ...(!current.publishedAt && incoming.publishedAt ? { publishedAt: incoming.publishedAt } : {}),
    ...(!current.description && incoming.description ? { description: incoming.description } : {}),
    ...(!current.coverUrl && incoming.coverUrl ? { coverUrl: incoming.coverUrl } : {}),
  };
}

function sourcePriority(sourceId: string): number {
  return sourceId === 'open_web' ? 0 : 1;
}
