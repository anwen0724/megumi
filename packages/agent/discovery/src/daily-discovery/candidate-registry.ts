/* Keeps normalized discovery candidates private to one daily Agent execution. */
import {
  SourceContentDetailSchema,
  SourceContentSchema,
  type SourceContent,
  type SourceContentDetail,
} from '../sources/discovery-source';
import { canonicalContentIdentity, sourceContentIdentity } from './content-identity';

export type DiscoveryCandidate = SourceContent & {
  readonly candidateId: string;
  readonly detail?: SourceContentDetail;
};

export interface CandidateRegistry {
  add(contents: readonly SourceContent[]): readonly DiscoveryCandidate[];
  get(candidateId: string): DiscoveryCandidate | undefined;
  list(): readonly DiscoveryCandidate[];
  attachDetail(candidateId: string, detail: SourceContentDetail): DiscoveryCandidate;
  dispose(): void;
}

export function createCandidateRegistry(): CandidateRegistry {
  const candidates = new Map<string, DiscoveryCandidate>();
  const candidateIdsByIdentity = new Map<string, string>();
  const candidateIdsBySourceIdentity = new Map<string, string>();
  let nextId = 1;
  let disposed = false;

  const assertActive = () => {
    if (disposed) throw new Error('Candidate registry has been disposed.');
  };

  return {
    add(contents) {
      assertActive();
      const inserted: DiscoveryCandidate[] = [];
      for (const input of contents) {
        const content = SourceContentSchema.parse(input);
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
          continue;
        }
        const candidateId = `candidate:${nextId++}`;
        const candidate = { candidateId, ...content };
        candidateIdsByIdentity.set(identity, candidateId);
        candidateIdsBySourceIdentity.set(sourceIdentity, candidateId);
        candidates.set(candidateId, candidate);
        inserted.push(candidate);
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
      disposed = true;
    },
  };
}

export function discoveryContentIdentity(content: SourceContent): string {
  return canonicalContentIdentity(content);
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
