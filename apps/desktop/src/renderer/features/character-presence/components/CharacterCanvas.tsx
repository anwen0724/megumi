/* Mounts the Pixi character scene and falls back to the same static asset when WebGL is unavailable. */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CharacterState } from '../character-state';
import {
  mountCharacterPresentation,
  type CharacterPresentation,
  type CharacterRenderBounds,
} from '../character-presentation';

export function CharacterCanvas(props: {
  readonly imageUrl: string;
  readonly state: CharacterState;
  readonly onLayout: (bounds: CharacterRenderBounds) => void;
}) {
  const { t } = useTranslation('character');
  const containerRef = useRef<HTMLDivElement>(null);
  const presentationRef = useRef<CharacterPresentation | null>(null);
  const stateRef = useRef(props.state);
  const [staticFallback, setStaticFallback] = useState(false);
  stateRef.current = props.state;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let cancelled = false;
    void mountCharacterPresentation({
      container,
      imageUrl: props.imageUrl,
      onLayout: props.onLayout,
      onUnavailable: () => setStaticFallback(true),
    }).then((presentation) => {
      if (cancelled) {
        void presentation?.dispose();
        return;
      }
      presentationRef.current = presentation;
      presentation?.setState(stateRef.current);
    });
    return () => {
      cancelled = true;
      const presentation = presentationRef.current;
      presentationRef.current = null;
      void presentation?.dispose();
    };
  }, [props.imageUrl, props.onLayout]);

  useEffect(() => { presentationRef.current?.setState(props.state); }, [props.state]);

  if (staticFallback) {
    return <img src={props.imageUrl} alt="Megumi" draggable={false} className="pointer-events-none h-full w-full select-none object-contain" />;
  }
  return <div ref={containerRef} className="pointer-events-none h-full w-full" aria-label={t('presentationLabel')} />;
}
