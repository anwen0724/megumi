/* Owns the disposable PixiJS scene that animates Megumi from canonical character facts. */
import { Easing, Group as TweenGroup, Tween } from '@tweenjs/tween.js';
import type { Ticker } from 'pixi.js';
import type { CharacterState } from './character-state';

export interface CharacterPresentation {
  setState(state: CharacterState): void;
  dispose(): Promise<void>;
}

export interface CharacterRenderBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface MountCharacterPresentationOptions {
  readonly container: HTMLElement;
  readonly imageUrl: string;
  readonly onLayout?: (bounds: CharacterRenderBounds) => void;
  readonly onUnavailable?: (message: string) => void;
  readonly createScene?: (
    container: HTMLElement,
    imageUrl: string,
    onLayout?: (bounds: CharacterRenderBounds) => void,
  ) => Promise<CharacterPresentation>;
}

/** Animation is presentation-only: a failed scene returns null so the caller can keep a static image. */
export async function mountCharacterPresentation(
  options: MountCharacterPresentationOptions,
): Promise<CharacterPresentation | null> {
  try {
    return await (options.createScene ?? createPixiCharacterScene)(
      options.container,
      options.imageUrl,
      options.onLayout,
    );
  } catch (error) {
    options.onUnavailable?.(error instanceof Error ? error.message : 'Character animation is unavailable.');
    return null;
  }
}

interface Pose {
  lift: number;
  lean: number;
  energy: number;
  glow: number;
}

const STATE_POSES: Record<CharacterState, Pose> = {
  idle: { lift: 0, lean: 0, energy: 0.25, glow: 0 },
  listening: { lift: -4, lean: -0.012, energy: 0.5, glow: 0.18 },
  recognizing: { lift: -2, lean: 0.012, energy: 0.45, glow: 0.12 },
  thinking: { lift: -3, lean: -0.018, energy: 0.35, glow: 0.12 },
  acting: { lift: -5, lean: 0.016, energy: 0.65, glow: 0.2 },
  approval: { lift: -4, lean: 0, energy: 0.4, glow: 0.3 },
  error: { lift: 0, lean: -0.01, energy: 0.15, glow: 0.28 },
};

const STATE_GLOW: Record<CharacterState, number> = {
  idle: 0x8aa4c2,
  listening: 0x68c8df,
  recognizing: 0xa7b6ea,
  thinking: 0xb3a5de,
  acting: 0x7ecfa8,
  approval: 0xf5c86b,
  error: 0xed7d7d,
};

async function createPixiCharacterScene(
  container: HTMLElement,
  imageUrl: string,
  onLayout?: (bounds: CharacterRenderBounds) => void,
): Promise<CharacterPresentation> {
  const { Application, Assets, Container, Graphics, Sprite } = await import('pixi.js');
  const app = new Application();
  await app.init({ antialias: true, backgroundAlpha: 0, resizeTo: container, resolution: window.devicePixelRatio || 1 });
  container.appendChild(app.canvas);

  const texture = await Assets.load(imageUrl);
  const glow = new Graphics();
  const root = new Container();
  const character = new Sprite(texture);
  const face = new Container();
  const eyelids = new Graphics();
  const tweens = new TweenGroup();
  const pose: Pose = { ...STATE_POSES.idle };
  let state: CharacterState = 'idle';
  let elapsed = 0;
  let nextBlinkAt = 2_600;
  let blinkUntil = 0;
  let disposed = false;

  character.anchor.set(0.5, 1);
  face.addChild(eyelids);
  root.addChild(character, face);
  app.stage.addChild(glow, root);

  const redrawFace = () => {
    const width = texture.width;
    const height = texture.height;
    eyelids.clear();
    if (elapsed < blinkUntil) {
      for (const eyeX of [-0.044, 0.044]) {
        eyelids
          .ellipse(eyeX * width, -0.884 * height, width * 0.026, height * 0.008)
          .fill({ color: 0xf3d7c8, alpha: 0.96 });
        eyelids
          .moveTo((eyeX - 0.025) * width, -0.884 * height)
          .bezierCurveTo(
            (eyeX - 0.008) * width, -0.878 * height,
            (eyeX + 0.008) * width, -0.878 * height,
            (eyeX + 0.025) * width, -0.884 * height,
          )
          .stroke({ color: 0x4b3434, width: Math.max(1, width * 0.0025), alpha: 0.9 });
      }
    }
  };

  const layout = () => {
    const availableWidth = Math.max(1, app.screen.width - 12);
    const availableHeight = Math.max(1, app.screen.height - 8);
    const fit = Math.min(availableWidth / texture.width, availableHeight / texture.height);
    root.position.set(app.screen.width / 2, app.screen.height + pose.lift);
    root.scale.set(fit);
    const characterBounds = character.getBounds();
    const containerBounds = container.getBoundingClientRect();
    onLayout?.({
      left: containerBounds.left + characterBounds.x,
      top: containerBounds.top + characterBounds.y,
      width: characterBounds.width,
      height: characterBounds.height,
    });
    glow.clear()
      .ellipse(app.screen.width / 2, app.screen.height * 0.48, Math.min(app.screen.width * 0.38, 180), app.screen.height * 0.34)
      .fill({ color: STATE_GLOW[state], alpha: pose.glow * 0.28 });
  };

  const ticker = (tick: Ticker) => {
    elapsed += tick.deltaMS;
    tweens.update(performance.now());
    if (elapsed >= nextBlinkAt) {
      blinkUntil = elapsed + 120;
      nextBlinkAt = elapsed + 3_200 + Math.random() * 2_400;
    }
    const breathing = Math.sin(elapsed / (1_250 - pose.energy * 260));
    const bob = breathing * (1.1 + pose.energy * 1.7);
    root.y = app.screen.height + pose.lift + bob;
    root.rotation = pose.lean + Math.sin(elapsed / 2_400) * 0.003 * pose.energy;
    redrawFace();
  };
  app.ticker.add(ticker);
  const resizeObserver = new ResizeObserver(layout);
  resizeObserver.observe(container);
  layout();

  return {
    setState(nextState) {
      if (disposed || state === nextState) return;
      state = nextState;
      tweens.removeAll();
      new Tween(pose, tweens)
        .to(STATE_POSES[nextState], 280)
        .easing(Easing.Quadratic.Out)
        .start(performance.now());
      layout();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      app.ticker.remove(ticker);
      tweens.removeAll();
      app.destroy(true, { children: true, texture: false });
    },
  };
}
