/* Renders compact voice, transcript-review, and manual interruption controls. */
import { LoaderCircle, Mic, MicOff, Pause, Play, Send, Square, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CharacterVoiceController } from '../use-character-voice';
import type { VoiceInputSnapshot } from '../../voice-input/voice-input-controller';
import type { SpeechOutputViewSnapshot } from '../speech-output/speech-output-controller';

export function VoiceControls(props: {
  readonly voice: CharacterVoiceController;
  readonly activeRunId?: string;
  readonly speechOutput?: SpeechOutputViewSnapshot;
}) {
  const { t } = useTranslation('character');
  const { voice } = props;
  const preparing = voice.preparing || voice.voiceSnapshot.status === 'preparing';
  const active = voice.voiceSnapshot.status !== 'idle';
  const muted = voice.voiceSnapshot.status === 'idle' ? false : voice.voiceSnapshot.muted;
  const manualMode = voice.audioSnapshot.speech === 'automatic-boundary-unavailable';

  return (
    <section className="app-no-drag w-full rounded-2xl border border-white/35 bg-slate-950/58 p-2.5 text-white shadow-xl backdrop-blur-xl">
      <div data-testid="voice-primary-row" className="flex items-center gap-2">
        {preparing ? (
          <button
            type="button"
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-white/70 px-3 text-sm font-medium text-slate-900 disabled:cursor-wait"
            disabled
          >
            <LoaderCircle className="animate-spin" size={16} />{t('voice.preparing')}
          </button>
        ) : !active ? (
          <button type="button" className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-white/90 px-3 text-sm font-medium text-slate-900" onClick={() => { void voice.start(); }}>
            <Mic size={16} />{t('voice.start')}
          </button>
        ) : (
          <>
            <button type="button" className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15 hover:bg-white/25" aria-label={t(muted ? 'voice.unmute' : 'voice.mute')} onClick={() => { void voice.setMuted(!muted); }}>
              {muted ? <MicOff size={17} /> : <Mic size={17} />}
            </button>
            <button type="button" className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-400/90 px-3 text-sm font-medium text-slate-950" onClick={() => { void voice.end(); }}>
              <Square size={14} />{t('voice.end')}
            </button>
          </>
        )}
      </div>

      {active && props.activeRunId ? (
        <button
          type="button"
          className="mt-2 w-full rounded-xl bg-sky-200 px-3 py-2 text-sm font-semibold text-sky-950"
          onClick={() => { void voice.interruptAndListen(props.activeRunId); }}
        >
          {t('interaction.interrupt')}
        </button>
      ) : null}

      {active && manualMode ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            data-testid="voice-manual-start"
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-200 px-3 text-sm font-medium text-amber-950"
            onClick={() => { void voice.beginManual(); }}
          >
            <Play size={15} />{t('voice.manualStart')}
          </button>
          <button
            type="button"
            data-testid="voice-manual-finish"
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-200 px-3 text-sm font-medium text-amber-950"
            onClick={() => { void voice.finishManual(); }}
          >
            <Pause size={15} />{t('voice.manualFinish')}
          </button>
        </div>
      ) : null}

      {active ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] text-white/70">
            <span data-testid="voice-input-status">{t(audioStatusKey(voice.audioSnapshot, muted))}</span>
            <span className="tabular-nums">{Math.round(voice.audioSnapshot.level * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-label={t('voice.inputLevel')}>
            <div
              data-testid="voice-input-meter"
              className={`h-full rounded-full transition-[width,background-color] duration-75 ${voice.audioSnapshot.speech === 'speech-detected' ? 'bg-emerald-300' : 'bg-sky-300'}`}
              style={{ width: `${Math.round(voice.audioSnapshot.level * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {props.speechOutput && props.speechOutput.status !== 'idle' ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-[11px] text-white/70">
            <span data-testid="speech-output-status">
              {t(props.speechOutput.status === 'error' ? 'voice.speechOutput.error' : 'voice.speechOutput.playing')}
            </span>
          </div>
          {props.speechOutput.status === 'error' && props.speechOutput.errorMessage ? (
            <p className="mt-1 text-xs text-rose-200">{props.speechOutput.errorMessage}</p>
          ) : null}
        </div>
      ) : null}

      <div data-testid="voice-text-row" className="mt-2 flex items-stretch gap-2">
        <textarea
          className="h-10 min-h-10 min-w-0 flex-1 resize-none overflow-y-auto rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm outline-none placeholder:text-white/45"
          value={voice.draft}
          placeholder={t('voice.inputPlaceholder')}
          onChange={(event) => voice.setDraft(event.target.value)}
          aria-label={t('voice.inputLabel')}
        />
        {voice.draft ? <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10" aria-label={t('voice.discard')} onClick={voice.discardDraft}><Undo2 size={15} /></button> : null}
        <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-300 text-slate-950 disabled:opacity-40" disabled={!voice.draft.trim()} aria-label={t('voice.send')} onClick={() => { void voice.submitText(voice.draft); }}><Send size={15} /></button>
      </div>
      {voice.audioSnapshot.issue === 'overflow' ? (
        <p className="mt-2 text-xs text-amber-100">{t('voice.overflow')}</p>
      ) : null}
      {voice.audioSnapshot.issue === 'too_short' ? (
        <p className="mt-2 text-xs text-amber-100">{t('voice.noSound')}</p>
      ) : null}
      {voice.audioSnapshot.issue === 'empty' ? (
        <p className="mt-2 text-xs text-amber-100">{t('voice.emptyResult')}</p>
      ) : null}
      {voice.audioSnapshot.microphoneError ? (
        <p className="mt-2 text-xs text-rose-200">{voice.audioSnapshot.microphoneError}</p>
      ) : null}
      {voice.audioSnapshot.speechError && voice.audioSnapshot.speech !== 'failed' ? (
        <p className="mt-2 text-xs text-rose-200">{voice.audioSnapshot.speechError}</p>
      ) : null}
      {voice.error ? <p className="mt-2 text-xs text-rose-200">{voice.error}</p> : null}
    </section>
  );
}

function audioStatusKey(snapshot: VoiceInputSnapshot, muted: boolean):
  | 'voice.capture.connecting'
  | 'voice.capture.listening'
  | 'voice.capture.speechDetected'
  | 'voice.capture.recognizing'
  | 'voice.capture.muted'
  | 'voice.capture.manual'
  | 'voice.capture.error' {
  if (muted || snapshot.microphone === 'muted') return 'voice.capture.muted';
  if (snapshot.microphone === 'failed' || snapshot.speech === 'failed') return 'voice.capture.error';
  if (snapshot.speech === 'recognizing') return 'voice.capture.recognizing';
  if (snapshot.speech === 'automatic-boundary-unavailable') return 'voice.capture.manual';
  if (snapshot.microphone === 'opening' || !snapshot.framesReceived) return 'voice.capture.connecting';
  if (snapshot.speech === 'speech-detected') return 'voice.capture.speechDetected';
  return 'voice.capture.listening';
}
