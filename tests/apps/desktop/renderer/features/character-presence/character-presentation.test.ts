import { describe, expect, it, vi } from 'vitest';
import { mountCharacterPresentation } from '@megumi/desktop/renderer/features/character-presence/character-presentation';

describe('mountCharacterPresentation', () => {
  it('keeps the product usable and requests a static fallback when animation initialization fails', async () => {
    const onUnavailable = vi.fn();
    const presentation = await mountCharacterPresentation({
      container: document.createElement('div'),
      imageUrl: 'megumi.png',
      onUnavailable,
      createScene: vi.fn(async () => { throw new Error('WebGL unavailable'); }),
    });

    expect(presentation).toBeNull();
    expect(onUnavailable).toHaveBeenCalledWith('WebGL unavailable');
  });
});
