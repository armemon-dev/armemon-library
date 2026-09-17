/**
 * FILE: multiselect.ts
 * PATH: packages/cli-kit/src/prompts/multiselect.ts
 *
 * WHAT: Thin wrapper over @clack/prompts' multiselect() with the shared cancel-
 *       handling behavior applied.
 * WHY:  See text.ts — identical rationale. This is what renders the plugin-selection
 *       checkbox (Step 4 of the init flow), the platform-selection checkbox, and any
 *       per-plugin multi-choice question (e.g. Redux's "which middlewares?"). Under
 *       --all-accept, ordinary multiselects fall back to their own initialValues
 *       like every other wrapper — but the two "select literally everything" macro
 *       questions (platforms, plugins/built-ins) need every option selected, not
 *       just their normal interactive default (e.g. platform's interactive default
 *       is iOS+Android, but --all-accept means all 5) — that's what the
 *       allAcceptSelectsAll opt-in is for, set only at those two call sites.
 * HOW:  Checks isAutoAcceptEnabled() first: if allAcceptSelectsAll is also set,
 *       returns every option's value; otherwise returns initialValues like the
 *       other three wrappers. Otherwise delegates to @clack/prompts.multiselect();
 *       same `as never` cast as select.ts for the same conditional-type-vs-generic-T
 *       reason.
 * WHEN: Used for the plugin/platform checkboxes and any wizard question with more
 *       than one simultaneous choice.
 *
 * EXPORTS: promptMultiselect, PromptMultiselectOptions, PromptMultiselectOption
 * DEPENDS ON: @clack/prompts, ./cancel, ./autoAccept, ./tty
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts, every plugin wizard
 */

import * as clack from '@clack/prompts';
import { handleCancel } from './cancel.js';
import { isAutoAcceptEnabled } from './autoAccept.js';
import { assertInteractive } from './tty.js';
import { CliError } from '../errors.js';

export interface PromptMultiselectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface PromptMultiselectOptions<T extends string> {
  message: string;
  options: Array<PromptMultiselectOption<T>>;
  initialValues?: T[];
  required?: boolean;
  /**
   * When true AND --all-accept is active, selects every option instead of
   * falling back to initialValues — for the two macro-level "select
   * everything" questions (platforms, plugins/built-ins) only.
   */
  allAcceptSelectsAll?: boolean;
}

export async function promptMultiselect<T extends string>(
  options: PromptMultiselectOptions<T>,
): Promise<T[]> {
  if (isAutoAcceptEnabled()) {
    if (options.allAcceptSelectsAll) {
      return options.options.map((option) => option.value);
    }
    const fallback = options.initialValues ?? [];
    const known = new Set(options.options.map((option) => option.value));
    const unknown = fallback.filter((value) => !known.has(value));
    if (unknown.length > 0) {
      throw new CliError(
        `The defaults for "${options.message}" include values that aren't options: ${unknown.join(', ')}.`,
        'This is a plugin bug: every initialValue must match one of the offered values.',
      );
    }
    if (options.required && fallback.length === 0) {
      throw new CliError(
        `"${options.message}" requires a selection, but its default is empty.`,
        'This is a plugin bug: a required multiselect needs a non-empty initialValues to support --all-accept.',
      );
    }
    return fallback;
  }

  assertInteractive(options.message);

  const result = await clack.multiselect<T>({
    message: options.message,
    options: options.options as never,
    initialValues: options.initialValues,
    required: options.required ?? false,
  });

  return handleCancel(result);
}
