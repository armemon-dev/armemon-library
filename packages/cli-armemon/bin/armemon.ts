#!/usr/bin/env node
/**
 * FILE: armemon.ts
 * PATH: packages/cli-armemon/bin/armemon.ts
 *
 * WHAT: The executable behind both of the package's commands, `armemon` and `memon` —
 *       the first thing that runs when a user types either, or
 *       `npx @armemon-library/cli ...`.
 * WHY:  npm requires a bin script as a real file (not just a package.json field
 *       pointing at library code); this is that file, kept intentionally tiny so all
 *       real logic lives in testable, importable modules.
 *
 *       Both commands point at this one file on purpose. `npx <package>` runs a
 *       package's command only when it can tell which one: a command named after the
 *       package (`cli` — there is none), or every command pointing at the same file.
 *       Two files and npx refuses with "could not determine executable to run".
 * HOW:  Builds the commander program via createProgram(), names it after the command
 *       that was typed so `memon --help` says `memon`, and parses argv with
 *       parseAsync, since the actions are async. Where the
 *       name can't be read (Windows' npm shims pass this file's own path), help
 *       says `armemon`; every command works the same either way.
 * WHEN: Runs once per CLI invocation.
 *
 * EXPORTS: (none — entry point only)
 * DEPENDS ON: ../src/index.js (createProgram)
 * USED BY: npm's bin resolution when `armemon` or `memon` is invoked
 */

import path from 'node:path';
import { createProgram } from '../src/index.js';

const program = createProgram();

const invokedAs = path.basename(process.argv[1] ?? '').replace(/\.[cm]?js$/, '');
if (invokedAs === 'memon') program.name('memon');

// parseAsync, because every command's action is async: parse() returns before the
// action finishes, so anything after it would run while the command was still going.
await program.parseAsync(process.argv);
