/*
 * Hosts the Character Presence renderer surface without creating a second chat history.
 * Rich interaction and animation are composed into this shell by character-presence features.
 */
import { Pin, PinOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CharacterWindowSnapshot } from '../../main/app/character-window-controller';
import { createSpeechPlaybackController, VoiceControls } from '../features/character-presence';

const characterImageUrl = new URL(
  '../../../assets/character/megumi/megumi-reference-v2.png',
  import.meta.url,
).href;

export default function CharacterApp() {
  const [snapshot, setSnapshot] = useState<CharacterWindowSnapshot | null>(null);

  useEffect(() => {
    void window.megumi.character.getSnapshot().then(setSnapshot);
    return window.megumi.character.onSnapshot(setSnapshot);
  }, []);

  useEffect(() => {
    const playback = createSpeechPlaybackController({
      report: (result) => { void window.megumi.voice.reportPlayback(result); },
    });
    const removeChunk = window.megumi.voice.onPlaybackChunk((chunk) => playback.acceptChunk(chunk));
    const removeStop = window.megumi.voice.onPlaybackStop(() => { void playback.stop(); });
    return () => {
      removeChunk();
      removeStop();
      void playback.dispose();
    };
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-transparent" aria-label="Megumi character">
      <div className="app-drag-region absolute inset-x-0 top-0 z-20 flex h-10 items-center justify-end gap-1 px-2">
        <button
          type="button"
          className="app-no-drag grid size-8 place-items-center rounded-full bg-black/20 text-white backdrop-blur-sm hover:bg-black/35"
          aria-label={snapshot?.alwaysOnTop === false ? 'Keep Megumi on top' : 'Stop keeping Megumi on top'}
          onClick={() => { void window.megumi.character.toggleAlwaysOnTop().then(setSnapshot); }}
        >
          {snapshot?.alwaysOnTop === false ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
        <button
          type="button"
          className="app-no-drag grid size-8 place-items-center rounded-full bg-black/20 text-white backdrop-blur-sm hover:bg-black/35"
          aria-label="Hide Megumi"
          onClick={() => { void window.megumi.character.hide(); }}
        >
          <X size={16} />
        </button>
      </div>

      <div className="app-drag-region flex h-full w-full items-end justify-center px-2 pb-2 pt-8">
        <img
          src={characterImageUrl}
          alt="Megumi"
          draggable={false}
          className="max-h-full max-w-full select-none object-contain drop-shadow-[0_14px_26px_rgba(18,20,28,0.24)]"
        />
      </div>
      <div className="absolute inset-x-2 bottom-2 z-20">
        <VoiceControls selectedSessionId={snapshot?.selectedSessionId ?? null} />
      </div>
    </main>
  );
}
