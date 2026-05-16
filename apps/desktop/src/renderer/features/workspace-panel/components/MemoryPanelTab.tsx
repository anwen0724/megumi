import { MemoryNoteCard, type MemoryNote } from '../../../entities/memory';
import { useMemoryStore } from '../../../entities/memory/store';
import { useWorkspaceStateStore } from '../../../entities/workspace-state';

interface MemoryPanelTabProps {
  notes?: MemoryNote[];
  loading?: boolean;
}

export function MemoryPanelTab({ notes, loading: legacyLoading = false }: MemoryPanelTabProps) {
  const storedNotes = useWorkspaceStateStore((state) => state.memoryNotes);
  const { settings, candidates, memories, recallPreview, loading, error } = useMemoryStore();
  const visibleNotes = notes ?? storedNotes;

  if (legacyLoading) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading memory</p>;
  }

  if (notes || visibleNotes.length > 0) {
    if (visibleNotes.length === 0) {
      return <p className="text-sm text-[var(--color-text-muted)]">No memory notes yet</p>;
    }

    return (
      <div className="space-y-3">
        {visibleNotes.map((note) => (
          <MemoryNoteCard key={note.id} note={note} />
        ))}
      </div>
    );
  }

  return (
    <section className="flex h-full flex-col gap-3 p-4 text-sm">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-100">Memory</h2>
        <span className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
          {settings?.autoCaptureEnabled ? 'auto capture on' : 'auto capture off'}
        </span>
      </header>

      {loading ? <p className="text-zinc-400">Loading memory...</p> : null}
      {error ? <p className="text-red-300">{error}</p> : null}

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase text-zinc-400">Candidates</h3>
        {candidates.length === 0 ? (
          <p className="text-zinc-500">No pending candidates.</p>
        ) : (
          candidates.map((candidate) => (
            <article key={candidate.candidateId} className="rounded border border-zinc-800 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-zinc-100">{candidate.summary}</p>
                <span className="text-xs text-zinc-400">{candidate.status}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-400">{candidate.scope} / {candidate.kind}</p>
            </article>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase text-zinc-400">Records</h3>
        {memories.length === 0 ? (
          <p className="text-zinc-500">No active memories.</p>
        ) : (
          memories.map((memory) => (
            <article key={memory.memoryId} className="rounded border border-zinc-800 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-zinc-100">{memory.summary}</p>
                <span className="text-xs text-zinc-400">{memory.status}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-400">{memory.scope} / {memory.kind}</p>
            </article>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase text-zinc-400">Recall preview</h3>
        {recallPreview ? (
          <p className="text-zinc-300">{recallPreview.results.length} memory results</p>
        ) : (
          <p className="text-zinc-500">No preview loaded.</p>
        )}
      </section>
    </section>
  );
}
