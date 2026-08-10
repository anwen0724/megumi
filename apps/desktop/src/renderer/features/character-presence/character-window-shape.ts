/* Converts the character PNG alpha mask and visible UI bounds into native window hit regions. */
import type { CharacterWindowShapeRect } from '../../../main/app/character-window-controller';

export interface CharacterAlphaMask {
  readonly width: number;
  readonly height: number;
  alphaAt(x: number, y: number): number;
}

export interface CharacterLayoutRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function createCharacterWindowShape(input: {
  readonly viewport: CharacterLayoutRect;
  readonly renderedBounds: CharacterLayoutRect;
  readonly mask: CharacterAlphaMask;
  readonly extraRects?: readonly CharacterLayoutRect[];
  readonly cellSize?: number;
  readonly safetyMargin?: number;
}): CharacterWindowShapeRect[] {
  const { viewport, renderedBounds, mask } = input;
  if (
    mask.width <= 0
    || mask.height <= 0
    || viewport.width <= 0
    || viewport.height <= 0
    || renderedBounds.width <= 0
    || renderedBounds.height <= 0
  ) {
    return normalizeExtraRects(input.extraRects ?? []);
  }

  // Pixi owns layout. Shaping only projects source alpha through the bounds that Pixi measured.
  const renderedWidth = renderedBounds.width;
  const renderedHeight = renderedBounds.height;
  const renderedLeft = renderedBounds.left;
  const renderedTop = renderedBounds.top;
  const scaleX = renderedWidth / mask.width;
  const scaleY = renderedHeight / mask.height;
  const cellSize = Math.max(2, Math.round(input.cellSize ?? 6));
  const rows: CharacterWindowShapeRect[][] = [];

  for (let y = renderedTop; y < renderedTop + renderedHeight; y += cellSize) {
    const rowHeight = Math.min(cellSize, Math.ceil(renderedTop + renderedHeight - y));
    const row: CharacterWindowShapeRect[] = [];
    let runStart: number | undefined;
    let runWidth = 0;

    for (let x = renderedLeft; x < renderedLeft + renderedWidth; x += cellSize) {
      const width = Math.min(cellSize, Math.ceil(renderedLeft + renderedWidth - x));
      const imageX = Math.min(mask.width - 1, Math.floor((x + (width / 2) - renderedLeft) / scaleX));
      const imageY = Math.min(mask.height - 1, Math.floor((y + (rowHeight / 2) - renderedTop) / scaleY));
      const opaque = mask.alphaAt(imageX, imageY) >= 24;

      if (opaque) {
        runStart ??= x;
        runWidth += width;
      } else if (runStart !== undefined) {
        row.push(toNativeRect(runStart, y, runWidth, rowHeight));
        runStart = undefined;
        runWidth = 0;
      }
    }

    if (runStart !== undefined) row.push(toNativeRect(runStart, y, runWidth, rowHeight));
    rows.push(row);
  }

  const safetyMargin = Math.max(0, Math.round(input.safetyMargin ?? 12));
  return [
    ...mergeVerticalRuns(rows).map((rect) => inflateWithinViewport(rect, safetyMargin, viewport)),
    ...normalizeExtraRects(input.extraRects ?? []),
  ];
}

function inflateWithinViewport(
  rect: CharacterWindowShapeRect,
  margin: number,
  viewport: CharacterLayoutRect,
): CharacterWindowShapeRect {
  const viewportRight = Math.ceil(viewport.left + viewport.width);
  const viewportBottom = Math.ceil(viewport.top + viewport.height);
  const left = Math.max(Math.floor(viewport.left), rect.x - margin);
  const top = Math.max(Math.floor(viewport.top), rect.y - margin);
  const right = Math.min(viewportRight, rect.x + rect.width + margin);
  const bottom = Math.min(viewportBottom, rect.y + rect.height + margin);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export async function loadCharacterAlphaMask(imageUrl: string): Promise<CharacterAlphaMask> {
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Character image could not be loaded for window shaping.'));
    image.src = imageUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Character shape canvas is unavailable.');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

  return {
    width: canvas.width,
    height: canvas.height,
    alphaAt(x, y) {
      const radius = 5;
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        const sampleY = y + offsetY;
        if (sampleY < 0 || sampleY >= canvas.height) continue;
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const sampleX = x + offsetX;
          if (sampleX < 0 || sampleX >= canvas.width) continue;
          if ((pixels[((sampleY * canvas.width) + sampleX) * 4 + 3] ?? 0) >= 24) return 255;
        }
      }
      return 0;
    },
  };
}

function mergeVerticalRuns(rows: readonly CharacterWindowShapeRect[][]): CharacterWindowShapeRect[] {
  const merged: CharacterWindowShapeRect[] = [];
  let active = new Map<string, CharacterWindowShapeRect>();

  for (const row of rows) {
    const next = new Map<string, CharacterWindowShapeRect>();
    for (const rect of row) {
      const key = `${rect.x}:${rect.width}`;
      const previous = active.get(key);
      if (previous && previous.y + previous.height === rect.y) {
        next.set(key, { ...previous, height: previous.height + rect.height });
        active.delete(key);
      } else {
        next.set(key, rect);
      }
    }
    merged.push(...active.values());
    active = next;
  }
  merged.push(...active.values());
  return merged;
}

function normalizeExtraRects(rects: readonly CharacterLayoutRect[]): CharacterWindowShapeRect[] {
  return rects
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => toNativeRect(rect.left, rect.top, rect.width, rect.height));
}

function toNativeRect(x: number, y: number, width: number, height: number): CharacterWindowShapeRect {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  return {
    x: left,
    y: top,
    width: Math.max(1, Math.ceil(x + width) - left),
    height: Math.max(1, Math.ceil(y + height) - top),
  };
}
