// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCharacterWindowShape,
  loadCharacterAlphaMask,
} from '@megumi/desktop/renderer/features/character-presence/character-window-shape';

describe('createCharacterWindowShape', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('turns opaque character pixels into native window rectangles', () => {
    const alpha = [
      0, 0, 0, 0,
      0, 255, 255, 0,
      0, 255, 255, 0,
      0, 0, 0, 0,
    ];
    const rects = createCharacterWindowShape({
      viewport: { left: 0, top: 0, width: 200, height: 200 },
      renderedBounds: { left: 6, top: 12, width: 188, height: 188 },
      mask: { width: 4, height: 4, alphaAt: (x, y) => alpha[(y * 4) + x] ?? 0 },
      cellSize: 50,
      safetyMargin: 0,
    });

    expect(rects).toContainEqual({ x: 56, y: 62, width: 100, height: 100 });
    expect(rects.some((rect) => rect.x === 0 && rect.y === 0)).toBe(false);
  });

  it('adds a restrained animation margin so native shaping cannot clip character pixels', () => {
    const rects = createCharacterWindowShape({
      viewport: { left: 0, top: 0, width: 200, height: 200 },
      renderedBounds: { left: 6, top: 12, width: 188, height: 188 },
      mask: { width: 4, height: 4, alphaAt: (x, y) => x === 1 && y === 1 ? 255 : 0 },
      cellSize: 50,
      safetyMargin: 12,
    });

    expect(rects).toContainEqual({ x: 44, y: 50, width: 74, height: 74 });
  });

  it('shapes the character at the renderer-measured bounds instead of re-deriving its layout', () => {
    const input = {
      viewport: { left: 0, top: 0, width: 200, height: 200 },
      renderedBounds: { left: 40, top: 80, width: 120, height: 160 },
      mask: {
        width: 4,
        height: 4,
        alphaAt: (x: number, y: number) => (y === 0 && (x === 1 || x === 2) ? 255 : 0),
      },
      cellSize: 20,
      safetyMargin: 0,
    };

    const rects = createCharacterWindowShape(input);

    expect(rects.some((rect) => (
      rect.x <= 80
      && rect.y <= 80
      && rect.x + rect.width > 80
      && rect.y + rect.height > 80
    ))).toBe(true);
  });

  it('adds the open interaction panel without making the remaining transparent window interactive', () => {
    const rects = createCharacterWindowShape({
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      renderedBounds: { left: 0, top: 0, width: 100, height: 100 },
      mask: { width: 1, height: 1, alphaAt: () => 255 },
      cellSize: 20,
      extraRects: [{ left: 120, top: 30, width: 220, height: 140 }],
    });

    expect(rects).toContainEqual({ x: 120, y: 30, width: 220, height: 140 });
  });

  it('registers load handlers before assigning a potentially cached image source', async () => {
    class SynchronouslyCachedImage {
      decoding = 'auto';
      naturalWidth = 1;
      naturalHeight = 1;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        expect(this.onload).toBeTypeOf('function');
        this.onload?.();
      }
    }
    vi.stubGlobal('Image', SynchronouslyCachedImage);
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
      }),
    } as never);

    const mask = await loadCharacterAlphaMask('cached-character.png');

    expect(mask.width).toBe(1);
    expect(mask.height).toBe(1);
    expect(mask.alphaAt(0, 0)).toBe(255);
  });
});
