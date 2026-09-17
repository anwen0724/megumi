/* Applies explicit non-thinking model parameters through the existing real provider adapter. */
import type { ProviderStreams, StreamOptions } from '@megumi/ai';
import { stream,streamSimple } from '@megumi/ai/api/openai-completions';

export const auditModelParameters={thinking:{type:'disabled'},temperature:0,max_tokens:8192} as const;

/** Preserves Harness callbacks and actual HTTP/model execution; changes only model request parameters. */
export const auditStreams:ProviderStreams={
  stream(model,context,options){return stream({...model,api:'openai-completions'},context,configure(options));},
  streamSimple(model,context,options){return streamSimple({...model,api:'openai-completions'},context,configure(options));},
};

function configure(options:StreamOptions|undefined):StreamOptions {
  const apiKey=process.env.DEEPSEEK_API_KEY;
  if(!apiKey)throw new Error('Required evaluation credential DEEPSEEK_API_KEY is missing');
  return {...options,apiKey,samplingParams:{...options?.samplingParams,...auditModelParameters}};
}
