import { MemoryNoteCard, type MemoryNote } from '../../../entities/memory';
import { useWorkspaceStateStore } from '../../../entities/workspace-state';

interface MemoryPanelTabProps {
  notes?: MemoryNote[];
  loading?: boolean;
}

export function MemoryPanelTab({ notes, loading = false }: MemoryPanelTabProps) {
  const storedNotes = useWorkspaceStateStore((state) => state.memoryNotes);
  const visibleNotes = notes ?? storedNotes;

  if (loading) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading memory</p>;
  }

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
