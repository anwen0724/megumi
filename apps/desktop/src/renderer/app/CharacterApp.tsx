/*
 * Hosts the single Character Presence surface for the selected normal Session.
 * The window renders current facts and delegates all Agent operations to existing Product contracts.
 */
import { Pin, PinOff, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CharacterWindowSnapshot } from '../../main/app/character-window-controller';
import {
  CharacterCanvas,
  CurrentInteractionView,
  createSpeechPlaybackController,
  resolveCharacterState,
  useCharacterInteraction,
  useCharacterVoice,
  VoiceControls,
} from '../features/character-presence';

const characterImageUrl = new URL(
  '../../../assets/character/megumi/megumi-reference-v2.png',
  import.meta.url,
).href;

export default function CharacterApp() {
  const { t } = useTranslation('character');
  const [snapshot, setSnapshot] = useState<CharacterWindowSnapshot | null>(null);
  const [playing, setPlaying] = useState(false);
  const [mouthLevel, setMouthLevel] = useState(0);
  const selectedSessionId = snapshot?.selectedSessionId ?? null;
  const voice = useCharacterVoice(selectedSessionId);
  const session = useCharacterInteraction(selectedSessionId);

  useEffect(() => {
    void window.megumi.character.getSnapshot().then(setSnapshot);
    return window.megumi.character.onSnapshot(setSnapshot);
  }, []);

  useEffect(() => {
    const playback = createSpeechPlaybackController({
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
  }, []);

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

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-transparent" aria-label={t('windowLabel')}>
      <div className="app-drag-region absolute inset-x-0 top-0 z-30 flex h-10 items-center justify-between gap-1 px-2">
        <span className="rounded-full bg-slate-950/45 px-2.5 py-1 text-[11px] font-medium text-white/85 backdrop-blur-md">
          {t(`states.${characterState}`)}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className="app-no-drag grid size-8 place-items-center rounded-full bg-black/20 text-white backdrop-blur-sm hover:bg-black/35"
            aria-label={t(snapshot?.alwaysOnTop === false ? 'keepOnTop' : 'stopKeepingOnTop')}
            onClick={() => { void window.megumi.character.toggleAlwaysOnTop().then(setSnapshot); }}
          >
            {snapshot?.alwaysOnTop === false ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
          <button
            type="button"
            className="app-no-drag grid size-8 place-items-center rounded-full bg-black/20 text-white backdrop-blur-sm hover:bg-black/35"
            aria-label={t('hide')}
            onClick={() => { void window.megumi.character.hide(); }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="app-drag-region absolute inset-0 pb-32 pt-7 drop-shadow-[0_14px_26px_rgba(18,20,28,0.24)]">
        {snapshot?.visible === false ? null : (
          <CharacterCanvas imageUrl={characterImageUrl} state={characterState} mouthLevel={mouthLevel} />
        )}
      </div>

      <div className="absolute inset-x-2 bottom-2 z-20 space-y-2">
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
    </main>
  );
}
