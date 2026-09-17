/**
 * FILE: select.ts
 * PATH: packages/cli-kit/src/prompts/select.ts
 *
 * WHAT: Thin wrapper over @clack/prompts' select() with the shared cancel-handling
 *       behavior applied.
 * WHY:  See text.ts — identical rationale, different prompt type. Under
 *       --all-accept, returns initialValue (or the first option as a fallback)
 *       instead of prompting — every current call site already sets initialValue,
 *       so this requires zero per-call-site changes to support the flag.
 * HOW:  Checks isAutoAcceptEnabled() first; otherwise delegates to
 *       @clack/prompts.select(), then runs the result through the shared
 *       handleCancel() guard. clack's Option<Value> type is conditional on Value
 *       extending Primitive, which TS can't resolve against our own generic T at this
 *       wrapper's call site — the `as never` cast below is narrowly scoped to that one
 *       argument so callers of promptSelect() still get full type safety.
 * WHEN: Used wherever a wizard needs a single choice from a fixed list (e.g. RN
 *       version, navigator type).
 *
 * EXPORTS: promptSelect, PromptSelectOptions, PromptSelectOption
 * DEPENDS ON: @clack/prompts, ./cancel, ./autoAccept, ./tty
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts, every plugin wizard
 */

import * as clack from '@clack/prompts';
import { handleCancel } from './cancel.js';
import { isAutoAcceptEnabled } from './autoAccept.js';
import { assertInteractive } from './tty.js';
import { CliError } from '../errors.js';

export interface PromptSelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface PromptSelectOptions<T extends string> {
  message: string;
  options: Array<PromptSelectOption<T>>;
  initialValue?: T;
}

export async function promptSelect<T extends string>(
  options: PromptSelectOptions<T>,
): Promise<T> {
  if (isAutoAcceptEnabled()) {
    const fallback = options.initialValue ?? options.options[0]?.value;
    if (fallback === undefined) {
      throw new CliError(
        `The question "${options.message}" has no options, so --all-accept has nothing to choose.`,
        'This is a plugin bug: a select prompt needs at least one option.',
      );
    }
    // An initialValue that isn't one of the options would be accepted verbatim and
    // flow into generated code as a value the plugin never handles.
    if (!options.options.some((option) => option.value === fallback)) {
      throw new CliError(
        `The default for "${options.message}" ("${fallback}") isn't one of its options.`,
        'This is a plugin bug: initialValue must match one of the offered values.',
      );
    }
    return fallback;
  }

  assertInteractive(options.message);

  const result = await clack.select<T>({
    message: options.message,
    options: options.options as never,
    initialValue: options.initialValue,
  });

  return handleCancel(result);
}
