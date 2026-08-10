/*
 * Hosts the shaped Character Presence surface for the selected normal Session.
 * Character gestures control only presentation; Agent operations stay on existing Product contracts.
 */
import { EyeOff, Monitor, Pin, PinOff, Settings } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { CharacterWindowSnapshot } from '../../main/app/character-window-controller';
import {
  CharacterCanvas,
  type CharacterRenderBounds,
  createCharacterWindowShape,
  loadCharacterAlphaMask,
  CurrentInteractionView,
  createSpeechPlaybackController,
  resolveCharacterState,
  useCharacterInteraction,
  useCharacterVoice,
  VoiceControls,
} from '../features/character-presence';

const DRAG_THRESHOLD_PX = 5;
const CHARACTER_BASE_WIDTH = 340;
const CHARACTER_BASE_HEIGHT = 680;
const CHARACTER_VISIBLE_RIGHT_RATIO = 0.72;
const SURFACE_GAP = 10;
const characterImageUrl = new URL(
  '../../../assets/character/megumi/megumi-reference-v2.png',
  import.meta.url,
).href;

interface DragGesture {
  readonly pointerId: number;
  readonly originScreenX: number;
  readonly originScreenY: number;
  readonly originWindowX: number;
  readonly originWindowY: number;
  dragging: boolean;
}

export default function CharacterApp() {
  const { t } = useTranslation('character');
  const [snapshot, setSnapshot] = useState<CharacterWindowSnapshot | null>(null);
  const [playing, setPlaying] = useState(false);
  const [mouthLevel, setMouthLevel] = useState(0);
  const [interactionOpen, setInteractionOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [characterRenderBounds, setCharacterRenderBounds] = useState<CharacterRenderBounds | null>(null);
  const [alphaMask, setAlphaMask] = useState<Awaited<ReturnType<typeof loadCharacterAlphaMask>> | null>(null);
  const snapshotRef = useRef<CharacterWindowSnapshot | null>(null);
  const characterViewportRef = useRef<HTMLDivElement>(null);
  const interactionPanelRef = useRef<HTMLDivElement>(null);
  const managementMenuRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragGesture | null>(null);
  const selectedSessionId = snapshot?.selectedSessionId ?? null;
  const characterScale = snapshot?.scale ?? 1;
  const companionSurfaceLeft = Math.round(
    CHARACTER_BASE_WIDTH * characterScale * CHARACTER_VISIBLE_RIGHT_RATIO,
  ) + SURFACE_GAP;
  const voice = useCharacterVoice(selectedSessionId);
  const session = useCharacterInteraction(selectedSessionId);

  const acceptCharacterLayout = useCallback((bounds: CharacterRenderBounds) => {
    setCharacterRenderBounds((current) => (
      current
      && Math.abs(current.left - bounds.left) < 0.25
      && Math.abs(current.top - bounds.top) < 0.25
      && Math.abs(current.width - bounds.width) < 0.25
      && Math.abs(current.height - bounds.height) < 0.25
        ? current
        : bounds
    ));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadCharacterAlphaMask(characterImageUrl)
      .then((mask) => { if (!cancelled) setAlphaMask(mask); })
      .catch(() => { if (!cancelled) setAlphaMask(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const acceptSnapshot = (next: CharacterWindowSnapshot) => {
      snapshotRef.current = next;
      setSnapshot(next);
    };
    void window.megumi.character.getSnapshot().then(acceptSnapshot);
    return window.megumi.character.onSnapshot(acceptSnapshot);
  }, []);

  const updateNativeShape = useCallback(() => {
    if (!snapshotRef.current) return;
    const viewport = characterViewportRef.current?.getBoundingClientRect();
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) return;
    const extraRects = [interactionPanelRef.current, managementMenuRef.current]
      .filter((element): element is HTMLDivElement => Boolean(element))
      .map((element) => element.getBoundingClientRect());
    const rects = alphaMask && characterRenderBounds
      ? createCharacterWindowShape({
        viewport,
        renderedBounds: characterRenderBounds,
        mask: alphaMask,
        extraRects,
      })
      : createCharacterWindowShape({
        viewport,
        renderedBounds: viewport,
        mask: { width: 1, height: 1, alphaAt: () => 255 },
        extraRects,
      });
    void window.megumi.character.setShape(rects);
  }, [alphaMask, characterRenderBounds]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(updateNativeShape);
    return () => window.cancelAnimationFrame(frame);
  }, [characterScale, interactionOpen, managementOpen, updateNativeShape]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateNativeShape);
    if (characterViewportRef.current) observer.observe(characterViewportRef.current);
    if (interactionPanelRef.current) observer.observe(interactionPanelRef.current);
    if (managementMenuRef.current) observer.observe(managementMenuRef.current);
    return () => observer.disconnect();
  }, [interactionOpen, managementOpen, updateNativeShape]);

  useEffect(() => {
    const closeTransientSurfaces = () => {
      setInteractionOpen(false);
      setManagementOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTransientSurfaces();
    };
    window.addEventListener('blur', closeTransientSurfaces);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('blur', closeTransientSurfaces);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const playback = createSpeechPlaybackController({
      outputDeviceId: voice.outputDeviceId,
      report: (result) => { void window.megumi.voice.reportPlayback(result); },
      onPlayingChanged: setPlaying,
      onLevel: setMouthLevel,
    });
    const removeChunk = window.megumi.voice.onPlaybackChunk((chunk) => playback.acceptChunk(chunk));
    const removeStop = window.megumi.voice.onPlaybackStop(() => { void playback.stop(); });
    return () => {
      removeChunk();
      removeStop();
      void playback.dispose();
    };
  }, [voice.outputDeviceId]);

  const characterState = useMemo(() => {
    const voiceStatus = voice.audioSnapshot.status === 'recognizing'
      ? 'recognizing'
      : session.interaction?.status === 'running'
        ? 'thinking'
        : voice.voiceSnapshot.status;
    return resolveCharacterState({
      voiceStatus,
      playing,
      pendingApproval: Boolean(session.interaction?.approval),
      activeTool: Boolean(session.interaction?.activeTool),
      error: Boolean(session.interaction?.error || voice.error || voice.audioSnapshot.status === 'error'),
    });
  }, [playing, session.interaction, voice.audioSnapshot.status, voice.error, voice.voiceSnapshot.status]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const bounds = snapshotRef.current?.bounds ?? { x: 0, y: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      originScreenX: event.screenX,
      originScreenY: event.screenY,
      originWindowX: bounds.x,
      originWindowY: bounds.y,
      dragging: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = dragRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.screenX - gesture.originScreenX;
    const deltaY = event.screenY - gesture.originScreenY;
    if (!gesture.dragging && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) return;
    gesture.dragging = true;
    setInteractionOpen(false);
    setManagementOpen(false);
    void window.megumi.character.moveTo(
      Math.round(gesture.originWindowX + deltaX),
      Math.round(gesture.originWindowY + deltaY),
    );
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = dragRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (gesture.dragging) return;
    setManagementOpen(false);
    setInteractionOpen((open) => !open);
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-transparent" aria-label={t('windowLabel')}>
      <div
        ref={characterViewportRef}
        data-testid="character-viewport"
        role="button"
        tabIndex={0}
        aria-label={t('interaction.toggle')}
        aria-expanded={interactionOpen}
        className="absolute bottom-0 left-0 cursor-grab touch-none select-none active:cursor-grabbing"
        style={{
          width: `${Math.round(CHARACTER_BASE_WIDTH * characterScale)}px`,
          height: `${Math.round(CHARACTER_BASE_HEIGHT * characterScale)}px`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = null; }}
        onContextMenu={(event) => {
          event.preventDefault();
          setInteractionOpen(false);
          setManagementOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setManagementOpen(false);
            setInteractionOpen((open) => !open);
          }
        }}
      >
        {snapshot?.visible ? (
          <CharacterCanvas
            imageUrl={characterImageUrl}
            state={characterState}
            mouthLevel={mouthLevel}
            onLayout={acceptCharacterLayout}
          />
        ) : null}
      </div>

      {interactionOpen ? (
        <div
          ref={interactionPanelRef}
          data-testid="character-interaction-panel"
          className="absolute bottom-3 z-20 w-[356px] rounded-[1.35rem] border border-white/20 bg-[#111622]/88 p-2.5 text-white shadow-[0_24px_70px_rgba(10,14,24,0.34)] backdrop-blur-2xl"
          style={{ left: `${companionSurfaceLeft}px` }}
        >
          <div className="mb-2 flex items-center gap-2 px-2 pt-1">
            <span className="size-1.5 rounded-full bg-[#d8b078] shadow-[0_0_0_4px_rgba(216,176,120,0.12)]" />
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-white/55">
              {t('interaction.panelTitle')}
            </span>
          </div>
          <div className="space-y-2">
            <CurrentInteractionView
              selectedSessionId={selectedSessionId}
              interaction={session.interaction}
              activeRunId={session.activeRunId}
              onApprovalResolve={session.resolveApproval}
              onCancel={session.cancelRun}
              onRetry={voice.submitText}
            />
            <VoiceControls voice={voice} activeRunId={session.activeRunId} playing={playing} />
          </div>
        </div>
      ) : null}

      {managementOpen ? (
        <div
          ref={managementMenuRef}
          data-testid="character-management-menu"
          role="menu"
          aria-label={t('managementMenu')}
          className="absolute top-4 z-30 w-52 overflow-hidden rounded-2xl border border-white/20 bg-[#111622]/92 p-1.5 text-sm text-white shadow-[0_18px_55px_rgba(10,14,24,0.38)] backdrop-blur-2xl"
          style={{ left: `${companionSurfaceLeft}px` }}
        >
          <MenuButton
            icon={snapshot?.alwaysOnTop === false ? <PinOff size={15} /> : <Pin size={15} />}
            label={t(snapshot?.alwaysOnTop === false ? 'keepOnTop' : 'stopKeepingOnTop')}
            onClick={() => {
              void window.megumi.character.toggleAlwaysOnTop().then(setSnapshot);
              setManagementOpen(false);
            }}
          />
          <MenuButton
            icon={<Monitor size={15} />}
            label={t('showMainWindow')}
            onClick={() => {
              void window.megumi.character.showMainWindow();
              setManagementOpen(false);
            }}
          />
          <div className="my-1 h-px bg-white/10" />
          <div className="rounded-xl px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between text-[0.72rem] text-white/65">
              <label htmlFor="character-scale">{t('size.label')}</label>
              <output htmlFor="character-scale" className="tabular-nums text-white/90">
                {Math.round(characterScale * 100)}%
              </output>
            </div>
            <input
              id="character-scale"
              type="range"
              min="70"
              max="130"
              step="1"
              value={Math.round(characterScale * 100)}
              aria-label={t('size.label')}
              className="h-1.5 w-full cursor-pointer accent-[#d8b078]"
              onChange={(event) => {
                const scale = Number(event.currentTarget.value) / 100;
                void window.megumi.character.setScale(scale).then((next) => {
                  snapshotRef.current = next;
                  setSnapshot(next);
                });
              }}
            />
          </div>
          <div className="my-1 h-px bg-white/10" />
          <MenuButton
            icon={<Settings size={15} />}
            label={t('settings')}
            onClick={() => {
              void window.megumi.character.openSettings();
              setManagementOpen(false);
            }}
          />
          <div className="my-1 h-px bg-white/10" />
          <MenuButton
            icon={<EyeOff size={15} />}
            label={t('hide')}
            onClick={() => { void window.megumi.character.hide(); }}
          />
        </div>
      ) : null}
    </main>
  );
}

function MenuButton(props: { readonly icon: ReactNode; readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left text-white/82 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d8b078]"
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}
