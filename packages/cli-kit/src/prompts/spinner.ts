/**
 * FILE: spinner.ts
 * PATH: packages/cli-kit/src/prompts/spinner.ts
 *
 * WHAT: "Run this async work, show progress with this label, report the outcome" —
 *       an animated @clack/prompts spinner on a real terminal, plain one-line
 *       start/finish logging anywhere else.
 * WHY:  Long-running shell-outs (RN CLI init, npm install, pod install) all need the
 *       same start/stop-with-message pattern. The non-TTY branch exists because
 *       clack's spinner writes raw cursor-control sequences unconditionally — piped
 *       into a CI log that renders as `[999D[J◒ working[999D[J◐ working…`, which is
 *       both unreadable and unsearchable. A CI run should produce grep-able lines.
 * HOW:  Branches on isInteractive(). The animated path stops the spinner with a
 *       success message on resolve or an error message (then rethrows) on reject;
 *       the plain path logs a step line before and a success/error line after.
 *
 *       withOutputStep is for work that writes to the terminal itself — a child
 *       process run with inherited stdio, like an install. An animated spinner and
 *       that output draw over each other, so those steps always take the plain path.
 * WHEN: withSpinner around quiet work; withOutputStep around a shell-out that prints.
 *
 * EXPORTS: withSpinner, withOutputStep
 * DEPENDS ON: @clack/prompts, ../logger, ./tty
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import * as clack from '@clack/prompts';
import { getLogStream, logger } from '../logger.js';
import { isInteractive } from './tty.js';

/** The plain path: a line before, a line after, nothing animated in between. */
async function plainStep<T>(label: string, work: () => Promise<T>, successLabel?: string): Promise<T> {
  logger.step(label);
  try {
    const result = await work();
    logger.success(successLabel ?? label);
    return result;
  } catch (error) {
    logger.error(`${label} — failed`);
    throw error;
  }
}

/**
 * For a step whose child process prints to the terminal itself — npm install, pod
 * install, React Native's CLI. Under a spinner the two redrew over each other, so the
 * tool's own progress and errors came out garbled exactly when they mattered.
 */
export function withOutputStep<T>(label: string, work: () => Promise<T>, successLabel?: string): Promise<T> {
  return plainStep(label, work, successLabel);
}

export async function withSpinner<T>(
  label: string,
  work: () => Promise<T>,
  successLabel?: string,
): Promise<T> {
  // clack's spinner always draws on stdout, which a JSON-printing command keeps clean.
  if (!isInteractive() || getLogStream() === 'stderr') return plainStep(label, work, successLabel);

  const spin = clack.spinner();
  spin.start(label);

  try {
    const result = await work();
    spin.stop(successLabel ?? label);
    return result;
  } catch (error) {
    spin.stop(`${label} — failed`, 1);
    throw error;
  }
}
