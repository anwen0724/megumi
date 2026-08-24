/* Assembles complete bundled locale resources for the Desktop Renderer. */
import type { AppLanguage } from '@megumi/product-host/host';
import { chat as enChat } from './en-US/chat';
import { character as enCharacter } from './en-US/character';
import { common as enCommon } from './en-US/common';
import { errors as enErrors } from './en-US/errors';
import { discovery as enDiscovery } from './en-US/discovery';
import { settings as enSettings } from './en-US/settings';
import { setup as enSetup } from './en-US/setup';
import { shell as enShell } from './en-US/shell';
import { chat as zhChat } from './zh-CN/chat';
import { character as zhCharacter } from './zh-CN/character';
import { common as zhCommon } from './zh-CN/common';
import { errors as zhErrors } from './zh-CN/errors';
import { discovery as zhDiscovery } from './zh-CN/discovery';
import { settings as zhSettings } from './zh-CN/settings';
import { setup as zhSetup } from './zh-CN/setup';
import { shell as zhShell } from './zh-CN/shell';
import type { TranslationShape } from './translation-shape';

export const enUS = {
  common: enCommon,
  setup: enSetup,
  shell: enShell,
  settings: enSettings,
  chat: enChat,
  character: enCharacter,
  errors: enErrors,
  discovery: enDiscovery,
} as const;

export type RendererResources = typeof enUS;

const zhCN = {
  common: zhCommon,
  setup: zhSetup,
  shell: zhShell,
  settings: zhSettings,
  chat: zhChat,
  character: zhCharacter,
  errors: zhErrors,
  discovery: zhDiscovery,
} as const satisfies TranslationShape<RendererResources>;

export const resources = {
  'en-US': enUS,
  'zh-CN': zhCN,
} as const satisfies Record<AppLanguage, TranslationShape<RendererResources>>;
