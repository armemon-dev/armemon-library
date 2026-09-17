/**
 * FILE: confirm.ts
 * PATH: packages/cli-kit/src/prompts/confirm.ts
 *
 * WHAT: Thin wrapper over @clack/prompts' confirm() with the shared cancel-handling
 *       behavior applied.
 * WHY:  See text.ts — identical rationale, different prompt type. Under
 *       --all-accept, returns initialValue (defaulting false) instead of prompting.
 * HOW:  Checks isAutoAcceptEnabled() first; otherwise delegates to
 *       @clack/prompts.confirm(), then runs the result through the shared
 *       handleCancel() guard.
 * WHEN: Used wherever a wizard needs a yes/no answer (e.g. "enable AsyncStorage
 *       persistence?").
 *
 * EXPORTS: promptConfirm, PromptConfirmOptions
 * DEPENDS ON: @clack/prompts, ./cancel, ./autoAccept, ./tty
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts, every plugin wizard
 */

import * as clack from '@clack/prompts';
import { handleCancel } from './cancel.js';
import { isAutoAcceptEnabled } from './autoAccept.js';
import { assertInteractive } from './tty.js';

export interface PromptConfirmOptions {
  message: string;
  initialValue?: boolean;
}

export async function promptConfirm(options: PromptConfirmOptions): Promise<boolean> {
  if (isAutoAcceptEnabled()) {
    return options.initialValue ?? false;
  }

  assertInteractive(options.message);

  const result = await clack.confirm({
    message: options.message,
    initialValue: options.initialValue,
  });

  return handleCancel(result);
}
