/* Assembles complete bundled locale resources for the Desktop Renderer. */
import type { AppLanguage } from '@megumi/product/host-interface';
import { chat as enChat } from './en-US/chat';
import { common as enCommon } from './en-US/common';
import { errors as enErrors } from './en-US/errors';
import { settings as enSettings } from './en-US/settings';
import { setup as enSetup } from './en-US/setup';
import { shell as enShell } from './en-US/shell';
import { chat as zhChat } from './zh-CN/chat';
import { common as zhCommon } from './zh-CN/common';
import { errors as zhErrors } from './zh-CN/errors';
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
  errors: enErrors,
} as const;

export type RendererResources = typeof enUS;

const zhCN = {
  common: zhCommon,
  setup: zhSetup,
  shell: zhShell,
  settings: zhSettings,
  chat: zhChat,
  errors: zhErrors,
} as const satisfies TranslationShape<RendererResources>;

export const resources = {
  'en-US': enUS,
  'zh-CN': zhCN,
} as const satisfies Record<AppLanguage, TranslationShape<RendererResources>>;
