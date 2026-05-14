import { Brain } from 'lucide-react';
import { Badge, Panel } from '../../shared/ui';

export type MemoryNoteKind = 'preference' | 'summary' | 'fact';

export interface MemoryNote {
  id: string;
  kind: MemoryNoteKind;
  title: string;
  body: string;
}

interface MemoryNoteCardProps {
  note: MemoryNote;
}

const kindLabels: Record<MemoryNoteKind, string> = {
  preference: 'Preference',
  summary: 'Summary',
  fact: 'Fact',
};

export function MemoryNoteCard({ note }: MemoryNoteCardProps) {
  return (
    <Panel className="p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-approval-soft)] text-[var(--color-approval)]">
          <Brain size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{note.title}</h3>
            <Badge variant="approval">{kindLabels[note.kind]}</Badge>
          </div>
          <p className="mt-2 text-sm leading-5 text-[var(--color-text-muted)]">{note.body}</p>
        </div>
      </div>
    </Panel>
  );
}
