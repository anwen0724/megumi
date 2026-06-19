import { useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';

const STICKY_THRESHOLD_PX = 48;

interface ScrollSessionState {
  followBottom: boolean;
  scrollTop: number;
}

interface TimelineAutoScrollOptions {
  sessionKey: string | null;
  updateKey: string;
}

const sessionScrollState = new Map<string, ScrollSessionState>();

function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

function isNearBottom(element: HTMLElement): boolean {
  return distanceFromBottom(element) <= STICKY_THRESHOLD_PX;
}

function scrollToBottom(element: HTMLElement): void {
  element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
}

function persistState(sessionKey: string | null, state: ScrollSessionState): void {
  if (sessionKey) {
    sessionScrollState.set(sessionKey, state);
  }
}

export function useTimelineAutoScroll({ sessionKey, updateKey }: TimelineAutoScrollOptions) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const stateRef = useRef<ScrollSessionState>({ followBottom: true, scrollTop: 0 });

  useEffect(() => {
    if (!sessionKey) {
      stateRef.current = { followBottom: true, scrollTop: 0 };
      return;
    }

    stateRef.current = sessionScrollState.get(sessionKey) ?? { followBottom: true, scrollTop: 0 };
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = stateRef.current.scrollTop;
    }
  }, [sessionKey]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stateRef.current.followBottom) {
      return undefined;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      scrollToBottom(element);
      stateRef.current = {
        followBottom: true,
        scrollTop: element.scrollTop,
      };
      if (sessionKey) {
        sessionScrollState.set(sessionKey, stateRef.current);
      }
    });

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [sessionKey, updateKey]);

  return useMemo(() => ({
    scrollRef,
    onScroll: () => {
      const element = scrollRef.current;
      if (!element) {
        return;
      }
      stateRef.current = {
        followBottom: isNearBottom(element),
        scrollTop: element.scrollTop,
      };
      persistState(sessionKey, stateRef.current);
    },
    onWheel: (event: WheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0) {
        stateRef.current = {
          ...stateRef.current,
          followBottom: false,
        };
        persistState(sessionKey, stateRef.current);
      }
    },
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      const element = scrollRef.current;
      if (!element || event.target !== element) {
        return;
      }

      const scrollbarClick = event.clientX >= element.clientWidth || event.clientY >= element.clientHeight;
      if (!scrollbarClick) {
        return;
      }

      stateRef.current = {
        ...stateRef.current,
        followBottom: false,
      };
      persistState(sessionKey, stateRef.current);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') {
        stateRef.current = {
          ...stateRef.current,
          followBottom: false,
        };
        persistState(sessionKey, stateRef.current);
      }
    },
  }), [sessionKey]);
}
