import type { KeyboardEvent, PointerEvent, WheelEvent, RefObject, ReactNode } from 'react';

interface MessageScrollPanelProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

export function MessageScrollPanel({
  scrollRef,
  onScroll,
  onWheel,
  onPointerDown,
  onKeyDown,
  children,
}: MessageScrollPanelProps) {
  return (
    <div
      ref={scrollRef}
      data-testid="message-scroll-panel"
      tabIndex={0}
      onScroll={onScroll}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="h-full min-h-0 overflow-y-auto"
    >
      {children}
    </div>
  );
}
