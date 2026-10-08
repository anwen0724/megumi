/* Renders host-verified citation metadata without exposing model protocol tags. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemoryCitation } from '@megumi/application/memory/memory-citations';
import { Button } from '../../shared/ui';
import { MemoryPanel } from './MemoryPanel';

/** Hides complete and streaming protocol blocks; trust comes only from host metadata. */
export function memoryReplyText(text: string): string {
  return text.replace(/<memory_citations>[\s\S]*?(?:<\/memory_citations>|$)/g, '').trimEnd();
}

/** Opens the cited version and range through the same bounded management reader. */
export function MemoryCitations({
  citations
}: {
  citations: readonly MemoryCitation[];
}) {
  const {
    t
  } = useTranslation('settings');
  const [selected, setSelected] = useState<MemoryCitation>();
  return <section aria-label={t('memory.references')} className="space-y-2 border-t border-[var(--color-border)] pt-2">
    <p className="text-xs text-[var(--color-text-muted)]">{t('memory.references')}</p>
    <div className="flex flex-wrap gap-2">{citations.map((citation, index) => <Button size="sm" key={`${citation.path}:${citation.startLine}:${index}`} onClick={() => setSelected(citation)}>{citation.path}:{citation.startLine}–{citation.endLine}</Button>)}
    </div>
    {selected && <MemoryPanel initialDocument={{
      path: selected.path,
      version: selected.fileVersion,
      startLine: selected.startLine
    }} onClose={() => setSelected(undefined)} />}
  </section>;
}
