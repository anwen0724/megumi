/* Keeps normalized discovery candidates private to one daily Agent execution. */
import {
  SourceContentDetailSchema,
  SourceContentSchema,
  type SourceContent,
  type SourceContentDetail,
} from '../sources/discovery-source';

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
        if (candidateIdsByIdentity.has(identity)) continue;
        const candidateId = `candidate:${nextId++}`;
        const candidate = { candidateId, ...content };
        candidateIdsByIdentity.set(identity, candidateId);
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
      disposed = true;
    },
  };
}

export function discoveryContentIdentity(content: SourceContent): string {
  if (content.sourceContentId) return `${content.sourceId}:id:${content.sourceContentId}`;
  const url = new URL(content.canonicalUrl);
  url.hash = '';
  url.searchParams.sort();
  return `${content.sourceId}:url:${url.toString()}`;
}
