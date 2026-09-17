/**
 * FILE: text.ts
 * PATH: packages/cli-kit/src/prompts/text.ts
 *
 * WHAT: Thin wrapper over @clack/prompts' text() that exits the process cleanly on
 *       Ctrl+C instead of returning clack's cancellation symbol to every call site.
 * WHY:  Every wizard question needs identical cancel-handling; without this wrapper
 *       each call site would need its own isCancel() check, which is exactly the kind
 *       of repeated boilerplate this package exists to remove. Under --all-accept,
 *       returns defaultValue (or placeholder as a fallback) instead of prompting —
 *       every current call site already sets at least one of the two, so this
 *       requires zero per-call-site changes to support the flag.
 * HOW:  Checks isAutoAcceptEnabled() first; otherwise delegates to
 *       @clack/prompts.text(), then runs the result through the shared
 *       handleCancel() guard.
 * WHEN: Used by every plugin/built-in wizard question that needs free-text input.
 *
 * EXPORTS: promptText, validateWithDefault, PromptTextOptions
 * DEPENDS ON: @clack/prompts, ./cancel, ./autoAccept, ./tty
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts, every plugin wizard
 */

import * as clack from '@clack/prompts';
import { handleCancel } from './cancel.js';
import { isAutoAcceptEnabled } from './autoAccept.js';
import { assertInteractive } from './tty.js';
import { CliError } from '../errors.js';

export interface PromptTextOptions {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: (value: string) => string | undefined;
}

/**
 * clack validates what was typed before it substitutes the default, so pressing Enter
 * to accept a default ran the validator on '' — and refused the very default the prompt
 * offered. An empty answer is validated as the default it becomes.
 */
export function validateWithDefault(
  validate: PromptTextOptions['validate'],
  defaultValue: string | undefined,
): PromptTextOptions['validate'] {
  if (!validate) return undefined;
  return (value) => validate(value === '' && defaultValue !== undefined ? defaultValue : value);
}

export async function promptText(options: PromptTextOptions): Promise<string> {
  if (isAutoAcceptEnabled()) {
    const fallback = options.defaultValue ?? options.placeholder;
    if (fallback === undefined) {
      throw new CliError(
        `The question "${options.message}" has no default, so --all-accept has nothing to accept.`,
        'This is a plugin bug: every prompt must supply a defaultValue or placeholder to support --all-accept.',
      );
    }
    // The auto-accepted value goes through the same validator a typed answer would.
    // Skipping it meant a plugin with an invalid default silently generated broken
    // output under --all-accept, where nobody is watching.
    const error = options.validate?.(fallback);
    if (error) {
      throw new CliError(
        `The default for "${options.message}" is itself invalid: ${error}`,
        'This is a plugin bug: --all-accept takes the default, so the default has to be valid.',
      );
    }
    return fallback;
  }

  assertInteractive(options.message);

  const result = await clack.text({
    message: options.message,
    placeholder: options.placeholder,
    defaultValue: options.defaultValue,
    validate: validateWithDefault(options.validate, options.defaultValue),
  });

  return handleCancel(result);
}
