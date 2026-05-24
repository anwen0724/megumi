// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { WheelEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineAutoScroll } from '@megumi/desktop/renderer/features/chat/hooks/use-timeline-auto-scroll';

function makeScrollElement() {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 500 });
  element.scrollTop = 400;
  element.scrollTo = vi.fn((arg1?: ScrollToOptions | number, arg2?: number) => {
    element.scrollTop = typeof arg1 === 'number'
      ? Number(arg2 ?? element.scrollTop)
      : Number(arg1?.top ?? element.scrollTop);
  }) as HTMLElement['scrollTo'];
  return element;
}

describe('useTimelineAutoScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('follows bottom while the session is sticky', () => {
    const { result, rerender } = renderHook(
      ({ updateKey }) => useTimelineAutoScroll({ sessionKey: 'project-1:session-1', updateKey }),
      { initialProps: { updateKey: 'one' } },
    );
    const element = makeScrollElement();

    act(() => {
      result.current.scrollRef.current = element;
    });
    rerender({ updateKey: 'two' });

    expect(element.scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'auto' });
  });

  it('does not follow bottom after the user scrolls upward', () => {
    const { result, rerender } = renderHook(
      ({ updateKey }) => useTimelineAutoScroll({ sessionKey: 'project-1:session-2', updateKey }),
      { initialProps: { updateKey: 'one' } },
    );
    const element = makeScrollElement();
    result.current.scrollRef.current = element;

    act(() => {
      element.scrollTop = 240;
      result.current.onWheel({ deltaY: -20 } as WheelEvent<HTMLDivElement>);
      result.current.onScroll();
    });
    rerender({ updateKey: 'two' });

    expect(element.scrollTo).not.toHaveBeenCalled();
  });

  it('keeps scroll state isolated by session key', () => {
    const { result, rerender } = renderHook(
      ({ sessionKey, updateKey }) => useTimelineAutoScroll({ sessionKey, updateKey }),
      { initialProps: { sessionKey: 'project-1:session-3', updateKey: 'one' } },
    );
    const first = makeScrollElement();
    result.current.scrollRef.current = first;

    act(() => {
      first.scrollTop = 100;
      result.current.onWheel({ deltaY: -30 } as WheelEvent<HTMLDivElement>);
      result.current.onScroll();
    });

    const second = makeScrollElement();
    rerender({ sessionKey: 'project-1:session-4', updateKey: 'one' });
    result.current.scrollRef.current = second;
    rerender({ sessionKey: 'project-1:session-4', updateKey: 'two' });

    expect(second.scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'auto' });
  });
});
