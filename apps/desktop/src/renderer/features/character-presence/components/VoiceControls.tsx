/* Renders compact voice, profile, transcript-review, and manual interruption controls. */
import type { VoiceHostProfile } from '@megumi/product/host';
import { Mic, MicOff, Plus, Send, Square, Undo2, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import type { CharacterVoiceController } from '../use-character-voice';

export function VoiceControls(props: {
  readonly voice: CharacterVoiceController;
  readonly activeRunId?: string;
  readonly playing: boolean;
}) {
  const { t } = useTranslation('character');
  const { voice } = props;
  const active = voice.voiceSnapshot.status !== 'idle';
  const muted = voice.voiceSnapshot.status === 'idle' ? false : voice.voiceSnapshot.muted;
  const fallback = voice.audioSnapshot.status === 'fallback';
  const [profiles, setProfiles] = useState<VoiceHostProfile[]>([]);
  const [addingProfile, setAddingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');

  const refreshProfiles = useCallback(async () => {
    const result = await window.megumi.voice.listProfiles(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.profilesList, {}),
    );
    if (result.ok && result.data.status === 'ok') setProfiles(result.data.profiles);
  }, []);
  useEffect(() => { void refreshProfiles(); }, [refreshProfiles]);

  const selectProfile = async (profileId: string) => {
    await window.megumi.voice.selectProfile(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.profileSelect, { profileId }),
    );
    await refreshProfiles();
  };
  const importProfile = async () => {
    if (!profileName.trim()) return;
    await window.megumi.voice.importProfile(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.profileImport, { name: profileName.trim() }),
    );
    setProfileName('');
    setAddingProfile(false);
    await refreshProfiles();
  };

  return (
    <section className="app-no-drag w-full rounded-2xl border border-white/35 bg-slate-950/58 p-3 text-white shadow-xl backdrop-blur-xl">
      <div className="mb-2 flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-white/65">
          <Volume2 size={14} />
          <span className="sr-only">{t('profiles.label')}</span>
          <select
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/10 px-2 py-1 outline-none"
            value={profiles.find((profile) => profile.selected)?.profileId ?? ''}
            onChange={(event) => { void selectProfile(event.target.value); }}
            aria-label={t('profiles.label')}
          >
            {profiles.map((profile) => <option className="text-slate-950" key={profile.profileId} value={profile.profileId}>{profile.name}</option>)}
          </select>
        </label>
        <button type="button" className="grid size-8 place-items-center rounded-lg bg-white/10 hover:bg-white/20" aria-label={t('profiles.add')} onClick={() => setAddingProfile((value) => !value)}>
          <Plus size={15} />
        </button>
      </div>
      {addingProfile ? (
        <div className="mb-2 flex gap-2">
          <input className="min-w-0 flex-1 rounded-lg bg-black/25 px-2 py-1.5 text-xs outline-none" value={profileName} placeholder={t('profiles.namePlaceholder')} onChange={(event) => setProfileName(event.target.value)} />
          <button type="button" className="rounded-lg bg-white/85 px-2 py-1 text-xs font-medium text-slate-950 disabled:opacity-40" disabled={!profileName.trim()} onClick={() => { void importProfile(); }}>{t('profiles.chooseAudio')}</button>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {!active ? (
          <button type="button" className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/90 px-3 py-2 text-sm font-medium text-slate-900" onClick={() => { void voice.start(); }}>
            <Mic size={16} />{t('voice.start')}
          </button>
        ) : (
          <>
            <button type="button" className="grid size-10 place-items-center rounded-xl bg-white/15 hover:bg-white/25" aria-label={t(muted ? 'voice.unmute' : 'voice.mute')} onClick={() => { void voice.setMuted(!muted); }}>
              {muted ? <MicOff size={17} /> : <Mic size={17} />}
            </button>
            <button type="button" className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-400/90 px-3 py-2 text-sm font-medium text-slate-950" onClick={() => { void voice.end(); }}>
              <Square size={14} />{t('voice.end')}
            </button>
          </>
        )}
        <span className="min-w-14 text-right text-xs text-white/70">{voice.audioSnapshot.status}</span>
      </div>

      {active && (props.activeRunId || props.playing) ? (
        <button
          type="button"
          className="mt-2 w-full rounded-xl bg-sky-200 px-3 py-2 text-sm font-semibold text-sky-950"
          onClick={() => { void voice.interruptAndListen(props.activeRunId); }}
        >
          {t('interaction.interrupt')}
        </button>
      ) : null}

      {fallback ? (
        <button
          type="button"
          className="mt-2 w-full rounded-xl bg-amber-200 px-3 py-2 text-sm font-medium text-amber-950"
          onPointerDown={() => { void voice.beginPushToTalk(); }}
          onPointerUp={() => { void voice.endPushToTalk(); }}
          onPointerCancel={() => { void voice.endPushToTalk(); }}
        >
          {t('voice.pushToTalk')}
        </button>
      ) : null}

      <div className="mt-2 flex items-end gap-2">
        <textarea
          className="max-h-24 min-h-10 flex-1 resize-none rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm outline-none placeholder:text-white/45"
          value={voice.draft}
          placeholder={t('voice.inputPlaceholder')}
          onChange={(event) => voice.setDraft(event.target.value)}
          aria-label={t('voice.inputLabel')}
        />
        {voice.draft ? <button type="button" className="grid size-9 place-items-center rounded-lg bg-white/10" aria-label={t('voice.discard')} onClick={voice.discardDraft}><Undo2 size={15} /></button> : null}
        <button type="button" className="grid size-9 place-items-center rounded-lg bg-sky-300 text-slate-950 disabled:opacity-40" disabled={!voice.draft.trim()} aria-label={t('voice.send')} onClick={() => { void voice.submitText(voice.draft); }}><Send size={15} /></button>
      </div>
      {voice.error ? <p className="mt-2 text-xs text-rose-200">{voice.error}</p> : null}
    </section>
  );
}
