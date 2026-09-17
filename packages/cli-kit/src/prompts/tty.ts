/**
 * FILE: tty.ts
 * PATH: packages/cli-kit/src/prompts/tty.ts
 *
 * WHAT: Re-exports the interactivity helpers next to the prompt wrappers that use
 *       them, so a prompt file imports its TTY guard from a sibling rather than
 *       reaching up a directory.
 * WHY:  Purely an ergonomics seam; the real implementation lives in ../errors.ts
 *       because the CLI's top-level handler needs CliError without pulling in the
 *       prompt layer.
 * HOW:  Barrel re-export.
 * WHEN: Imported by every prompt wrapper.
 *
 * EXPORTS: isInteractive, assertInteractive
 * DEPENDS ON: ../errors
 * USED BY: packages/cli-kit/src/prompts/{text,select,confirm,multiselect}.ts
 */

export { isInteractive, assertInteractive } from '../errors.js';
