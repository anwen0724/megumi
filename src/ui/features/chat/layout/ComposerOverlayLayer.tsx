import type { ReactNode } from 'react';

interface ComposerOverlayLayerProps {
  children: ReactNode;
}

export function ComposerOverlayLayer({ children }: ComposerOverlayLayerProps) {
  return (
    <div
      data-testid="composer-overlay-layer"
      className="pointer-events-auto absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-20 flex max-h-[min(24rem,calc(100vh-12rem))] flex-col gap-2 overflow-y-auto"
    >
      {children}
    </div>
  );
}
