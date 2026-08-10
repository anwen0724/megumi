/* Renders the compact microphone, transcript-review, and fallback push-to-talk controls. */
import { Mic, MicOff, Send, Square, Undo2 } from 'lucide-react';
import { useCharacterVoice } from '../use-character-voice';

export function VoiceControls({ selectedSessionId }: { readonly selectedSessionId: string | null }) {
  const voice = useCharacterVoice(selectedSessionId);
  const active = voice.voiceSnapshot.status !== 'idle';
  const muted = voice.voiceSnapshot.status === 'idle' ? false : voice.voiceSnapshot.muted;
  const fallback = voice.audioSnapshot.status === 'fallback';

  return (
    <section className="app-no-drag w-full rounded-2xl border border-white/35 bg-slate-950/55 p-3 text-white shadow-xl backdrop-blur-md">
      <div className="flex items-center gap-2">
        {!active ? (
          <button type="button" className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/90 px-3 py-2 text-sm font-medium text-slate-900" onClick={() => { void voice.start(); }}>
            <Mic size={16} />开始语音
          </button>
        ) : (
          <>
            <button type="button" className="grid size-10 place-items-center rounded-xl bg-white/15 hover:bg-white/25" aria-label={muted ? '取消静音' : '静音'} onClick={() => { void voice.setMuted(!muted); }}>
              {muted ? <MicOff size={17} /> : <Mic size={17} />}
            </button>
            <button type="button" className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-400/90 px-3 py-2 text-sm font-medium text-slate-950" onClick={() => { void voice.end(); }}>
              <Square size={14} />结束语音
            </button>
          </>
        )}
        <span className="min-w-14 text-right text-xs text-white/70">{voice.audioSnapshot.status}</span>
      </div>

      {fallback ? (
        <button
          type="button"
          className="mt-2 w-full rounded-xl bg-amber-200 px-3 py-2 text-sm font-medium text-amber-950"
          onPointerDown={() => { void voice.beginPushToTalk(); }}
          onPointerUp={() => { void voice.endPushToTalk(); }}
          onPointerCancel={() => { void voice.endPushToTalk(); }}
        >
          按住说话
        </button>
      ) : null}

      <div className="mt-2 flex items-end gap-2">
        <textarea
          className="max-h-24 min-h-10 flex-1 resize-none rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm outline-none placeholder:text-white/45"
          value={voice.draft}
          placeholder="也可以直接输入文字…"
          onChange={(event) => voice.setDraft(event.target.value)}
          aria-label="人物窗口文字输入"
        />
        {voice.draft ? <button type="button" className="grid size-9 place-items-center rounded-lg bg-white/10" aria-label="撤销当前输入" onClick={voice.discardDraft}><Undo2 size={15} /></button> : null}
        <button type="button" className="grid size-9 place-items-center rounded-lg bg-sky-300 text-slate-950 disabled:opacity-40" disabled={!voice.draft.trim()} aria-label="发送输入" onClick={() => { void voice.submitText(voice.draft); }}><Send size={15} /></button>
      </div>
      {voice.error ? <p className="mt-2 text-xs text-rose-200">{voice.error}</p> : null}
    </section>
  );
}
