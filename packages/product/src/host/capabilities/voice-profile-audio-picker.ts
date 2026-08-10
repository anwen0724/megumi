/* Lets Product request a reference-audio file without depending on Desktop APIs. */

export type VoiceProfileAudioPickerResult =
  | { readonly status: 'selected'; readonly sourceAudioPath: string }
  | { readonly status: 'cancelled' };

export interface VoiceProfileAudioPicker {
  chooseReferenceAudio(): Promise<VoiceProfileAudioPickerResult>;
}
