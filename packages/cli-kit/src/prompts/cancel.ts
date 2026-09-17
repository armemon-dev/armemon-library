/**
 * FILE: cancel.ts
 * PATH: packages/cli-kit/src/prompts/cancel.ts
 *
 * WHAT: Shared cancellation check for every @clack/prompts wrapper in this package.
 * WHY:  @clack/prompts returns a unique symbol (not a thrown error) when the user
 *       presses Ctrl+C; every prompt wrapper needs the same "detect it, unwind
 *       cleanly" behavior. It THROWS a CancelledError rather than calling
 *       process.exit() directly, because exiting from inside a prompt skipped the
 *       init flow's cleanup entirely — a Ctrl+C halfway through the wizard left a
 *       half-scaffolded directory on disk with no message about it and no way to
 *       resume. Throwing lets the flow's own try/finally remove what it created.
 * HOW:  Uses clack's own isCancel() guard; narrows the type so callers get a plain
 *       value back with no symbol in the type.
 * WHEN: Called by every function in prompts/{text,select,confirm,multiselect}.ts.
 *
 * EXPORTS: handleCancel, CancelledError, isCancelledError
 * DEPENDS ON: @clack/prompts
 * USED BY: packages/cli-kit/src/prompts/*.ts, packages/cli-armemon/src/**
 */

import * as clack from '@clack/prompts';

export class CancelledError extends Error {
  readonly isCancelledError = true;

  constructor() {
    super('Cancelled.');
    this.name = 'CancelledError';
  }
}

export function isCancelledError(error: unknown): error is CancelledError {
  return error instanceof Error && (error as CancelledError).isCancelledError === true;
}

export function handleCancel<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    throw new CancelledError();
  }

  return value;
}
