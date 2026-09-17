/**
 * FILE: errors.ts
 * PATH: packages/cli-kit/src/errors.ts
 *
 * WHAT: CliError — an error the CLI knows how to present, plus isInteractive()/
 *       assertInteractive() for the one failure mode that is never the user's fault
 *       to debug: running an interactive wizard where no terminal exists.
 * WHY:  Everything thrown out of the init flow used to reach Node as an unhandled
 *       rejection and print a raw stack with internal bundle paths — including the
 *       completely predictable case of piped stdin, where @clack/prompts dies with
 *       ERR_TTY_INIT_FAILED deep inside its own internals. A CliError carries a
 *       message written for the person running the command plus an optional `hint`
 *       naming the way out, and the top-level handler prints those two lines instead
 *       of a stack (the stack stays available behind ARMEMON_DEBUG).
 * HOW:  A plain Error subclass with a marker property, so the handler can tell
 *       "expected, already explained" from "genuinely unexpected, show everything".
 * WHEN: Thrown by prompt wrappers, preflight checks, and any flow step that can fail
 *       in a way the user can act on; caught once in cli-armemon's command handler.
 *
 * EXPORTS: CliError, isCliError, isInteractive, assertInteractive
 * DEPENDS ON: nothing
 * USED BY: packages/cli-kit/src/prompts/*, packages/cli-armemon/src/**
 */

export class CliError extends Error {
  readonly isCliError = true;
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.hint = hint;
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof Error && (error as CliError).isCliError === true;
}

/**
 * True only when both ends of the terminal are real TTYs. `CI=true` counts as
 * non-interactive even on a machine that happens to have a TTY, because a CI job
 * that blocks on a prompt hangs until its own timeout rather than failing fast.
 */
export function isInteractive(): boolean {
  if (process.env.ARMEMON_FORCE_INTERACTIVE === '1') return true;
  if (process.env.CI && process.env.CI !== 'false') return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function assertInteractive(what: string): void {
  if (isInteractive()) return;
  throw new CliError(
    `"${what}" needs an interactive terminal, and this one isn't (no TTY${
      process.env.CI ? ', and CI is set' : ''
    }).`,
    'Re-run with --all-accept to take every default, or pass the answers as flags (--platforms, --pm, --plugins, --rn-version). See `armemon init react-native --help`.',
  );
}
