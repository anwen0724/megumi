/* Mounts the Pixi character scene and falls back to the same static asset when WebGL is unavailable. */
import { useEffect, useRef, useState } from 'react';
import type { CharacterState } from '../character-state';
import { mountCharacterPresentation, type CharacterPresentation } from '../character-presentation';

export function CharacterCanvas(props: {
  readonly imageUrl: string;
  readonly state: CharacterState;
  readonly mouthLevel: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const presentationRef = useRef<CharacterPresentation | null>(null);
  const stateRef = useRef(props.state);
  const mouthLevelRef = useRef(props.mouthLevel);
  const [staticFallback, setStaticFallback] = useState(false);
  stateRef.current = props.state;
  mouthLevelRef.current = props.mouthLevel;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let cancelled = false;
    void mountCharacterPresentation({
      container,
      imageUrl: props.imageUrl,
      onUnavailable: () => setStaticFallback(true),
    }).then((presentation) => {
      if (cancelled) {
        void presentation?.dispose();
        return;
      }
      presentationRef.current = presentation;
      presentation?.setState(stateRef.current);
      presentation?.setMouthLevel(mouthLevelRef.current);
    });
    return () => {
      cancelled = true;
      const presentation = presentationRef.current;
      presentationRef.current = null;
      void presentation?.dispose();
    };
  }, [props.imageUrl]);

  useEffect(() => { presentationRef.current?.setState(props.state); }, [props.state]);
  useEffect(() => { presentationRef.current?.setMouthLevel(props.mouthLevel); }, [props.mouthLevel]);

  if (staticFallback) {
    return <img src={props.imageUrl} alt="Megumi" draggable={false} className="h-full w-full select-none object-contain" />;
  }
  return <div ref={containerRef} className="h-full w-full" aria-label="Megumi animated character" />;
}
