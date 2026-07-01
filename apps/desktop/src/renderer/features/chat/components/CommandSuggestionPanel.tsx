// Renders command suggestions supplied by a trusted catalog; this component does not own command discovery.
interface CommandSuggestion {
  name: string;
  description: string;
}

interface CommandSuggestionPanelProps {
  suggestions: CommandSuggestion[];
  selectedIndex: number;
  onChoose: (command: CommandSuggestion) => void;
}

export function CommandSuggestionPanel({
  suggestions,
  selectedIndex,
  onChoose,
}: CommandSuggestionPanelProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="command-suggestion-panel"
      role="listbox"
      aria-label="Command suggestions"
      className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)]"
    >
      {suggestions.map((command, index) => (
        <button
          key={command.name}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          aria-label={`/${command.name} ${command.description}`}
          className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] aria-selected:bg-[var(--color-surface-hover)]"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(command)}
        >
          <span className="shrink-0 font-mono text-[var(--color-text)]">{`/${command.name}`}</span>
          <span className="min-w-0 truncate text-xs text-[var(--color-text-muted)]">{command.description}</span>
        </button>
      ))}
    </div>
  );
}
