import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Keeps sidebar dragging local and releases pointer listeners when the view closes. */
export function useSidebarResize(initialWidth: number, minWidth: number, maxWidth: number, direction: 1 | -1) {
  const [width, setWidth] = useState(initialWidth);
  const [resizing, setResizing] = useState(false);
  const finishDrag = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => finishDrag.current?.(), []);

  function startResize(event: ReactPointerEvent, availableWidth = maxWidth) {
    if (event.button !== 0) return;
    event.preventDefault();
    finishDrag.current?.();
    const startX = event.clientX;
    const startWidth = width;
    const limit = Math.max(minWidth, Math.min(maxWidth, availableWidth));
    const cursor = document.body.style.cursor;
    const userSelect = document.body.style.userSelect;
    function move(moveEvent: PointerEvent) {
      setWidth(Math.min(limit, Math.max(minWidth, startWidth + direction * (moveEvent.clientX - startX))));
    }
    function finish() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      finishDrag.current = undefined;
      setResizing(false);
    }
    finishDrag.current = finish;
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  return { width, resizing, startResize };
}
