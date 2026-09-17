/**
 * FILE: commandReference.test.ts
 * PATH: packages/cli-armemon/test/commandReference.test.ts
 *
 * WHAT: The command reference written into every scaffolded app's guide.
 * WHY:  The reference is generated from the live program precisely so it cannot go
 *       stale — but "generated" only helps if the walker actually reaches everything.
 *       A recursion bug would drop `init react-native` and all four `link`
 *       subcommands, and nothing would fail: the guide would just quietly stop
 *       describing a third of the CLI.
 *
 *       So these assert coverage against the program itself rather than against a
 *       fixed list. Add a command or a flag and this passes for the right reason;
 *       break the walk and it fails immediately.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';
import { DEFAULT_LAYOUT, managedReadme } from '@armemon-library/cli-kit';
import { buildCommandReference, createProgram } from '../dist/index.js';

const program = createProgram([]);
const reference = buildCommandReference(program);

/** Every command and subcommand, by the path someone would actually type. */
function everyCommand(command: Command, prefix: string[] = []): Array<{ path: string; command: Command }> {
  const path = [...prefix, command.name()];
  return [
    { path: path.join(' '), command },
    ...command.commands.flatMap((sub) => everyCommand(sub, path)),
  ];
}

const all = program.commands.flatMap((command) => everyCommand(command));

describe('buildCommandReference', () => {
  it('reaches the nested commands, not just the top level', () => {
    const paths = all.map((entry) => entry.path);
    expect(paths).toContain('init react-native');
    expect(paths).toContain('link add');
    expect(paths.length).toBeGreaterThan(program.commands.length);
  });

  it.each(all.map((entry) => entry.path))('documents `%s`', (path) => {
    expect(reference).toContain(`armemon ${path}`);
  });

  it('documents every flag of every command', () => {
    const missing: string[] = [];
    for (const { path, command } of all) {
      for (const option of command.options) {
        if (!reference.includes(`\`${option.flags}\``)) missing.push(`${path} ${option.flags}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('documents every argument of every command', () => {
    const missing: string[] = [];
    for (const { path, command } of all) {
      for (const argument of command.registeredArguments ?? []) {
        const rendered = argument.required ? `<${argument.name()}>` : `[${argument.name()}]`;
        if (!reference.includes(rendered)) missing.push(`${path} ${rendered}`);
      }
    }
    expect(missing).toEqual([]);
  });

  /** A blank cell in the table means someone registered an argument with no help. */
  it('leaves no argument without a description', () => {
    const undocumented: string[] = [];
    for (const { path, command } of all) {
      for (const argument of command.registeredArguments ?? []) {
        if (!argument.description) undocumented.push(`${path} ${argument.name()}`);
      }
    }
    expect(undocumented).toEqual([]);
  });

  it('carries each command description across', () => {
    for (const { command } of all) {
      const description = command.description();
      if (description) expect(reference).toContain(description);
    }
  });

  /** Curated examples are the one hand-written part, so they can name a dead command. */
  it('only shows examples for commands that exist', () => {
    const paths = new Set(all.map((entry) => entry.path));
    const shown = [...reference.matchAll(/^armemon ([a-z-]+(?: [a-z-]+)?)/gm)].map((match) => match[1]);

    for (const candidate of new Set(shown)) {
      const known = paths.has(candidate!) || paths.has(candidate!.split(' ')[0]!);
      expect(known, `example names "${candidate}", which is not a command`).toBe(true);
    }
  });

  it('explains the flags that repeat across commands once, up front', () => {
    for (const flag of ['--dir <path>', '--dry-run', '--json', '--all-accept', '--no-verify']) {
      expect(reference).toContain(flag);
    }
    expect(reference).toContain('Options that work on most commands');
  });
});

/**
 * Found by reading the rendered guide, not by any check above.
 *
 * `--language`'s description really is "ts | js". An unescaped pipe inside a table
 * cell ends that cell, so the row grows a column and the table is malformed from
 * there down — while every coverage test still passes, because the flag is present
 * and correctly spelled. Shape, not content, is what catches it.
 */
describe('the generated tables survive the descriptions put in them', () => {
  it('escapes a pipe that appears inside a description', () => {
    expect(reference).toContain('ts \\| js');
  });

  it('leaves every row with exactly the columns its table declares', () => {
    const malformed = reference
      .split('\n')
      .filter((line) => line.startsWith('| '))
      // An escaped pipe is content, not a column boundary.
      .filter((line) => line.replace(/\\\|/g, '').split('|').length - 1 !== 3);

    expect(malformed).toEqual([]);
  });
});

/**
 * "Ready to copy and paste" is a promise the guide makes to beginners, so it is checked
 * rather than trusted: every `armemon …` line in the finished guide — the hand-written
 * everyday tasks as well as the generated examples — has to name a real command and
 * use only options that command accepts. A renamed flag fails here, not in someone's
 * terminal.
 */
describe('every command in the guide can be pasted as written', () => {
  const guide = `${managedReadme(DEFAULT_LAYOUT)}${reference}`;
  const byPath = new Map(all.map((entry) => [entry.path, entry.command]));

  const pasteable = guide
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('armemon '));

  const words = (line: string) => [...line.matchAll(/"[^"]*"|'[^']*'|\S+/g)].map((match) => match[0]);

  it('finds the commands it is meant to check', () => {
    expect(pasteable.length).toBeGreaterThan(40);
  });

  it.each(pasteable)('%s', (line) => {
    const parts = words(line).slice(1);

    if (parts[0]?.startsWith('-')) {
      for (const flag of parts) expect(['--help', '--version']).toContain(flag);
      return;
    }

    const command = byPath.get(parts.slice(0, 2).join(' ')) ?? byPath.get(parts[0] ?? '');
    expect(command, `"${parts[0]}" is not an armemon command`).toBeDefined();

    const accepted = new Set([...command!.options.map((option) => option.long), '--help']);
    for (const part of parts.filter((word) => word.startsWith('--'))) {
      const flag = part.split('=')[0]!;
      expect(accepted.has(flag), `${flag} is not an option of this command`).toBe(true);
    }
  });
});
