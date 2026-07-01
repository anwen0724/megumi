import { ComposerSurface } from './ComposerSurface';
import type { ComposerProps } from './composer-types';
import { useComposerController } from '../hooks/use-composer-controller';

export type { ComposerStatus, ComposerSubmitPayload } from './composer-types';

export function Composer(props: ComposerProps) {
  const { composerSurfaceProps } = useComposerController(props);

  return (
    <div data-testid="composer-stack" className="pointer-events-auto mx-auto flex w-full flex-col gap-2">
      <ComposerSurface {...composerSurfaceProps} />
    </div>
  );
}
