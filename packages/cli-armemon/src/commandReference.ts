/**
 * FILE: commandReference.ts
 * PATH: packages/cli-armemon/src/commandReference.ts
 *
 * WHAT: The full command reference written into a scaffolded app's guide — every
 *       command, every argument, every flag, and the combinations worth knowing.
 * WHY:  A hand-written flag table is wrong the first time anyone adds an option, and
 *       it is wrong silently: nothing fails, the docs just quietly stop describing the
 *       tool. Commander already holds the truth — it has to, to parse argv — so this
 *       reads the registered program rather than restating it. Adding a flag updates
 *       the guide by construction.
 * HOW:  Walks the program depth-first, recursing into subcommands (init and link both
 *       nest, and a flat walk would document neither). Names, flags, arguments and
 *       descriptions come through commander's accessors — they live on the prototype,
 *       so enumerating own keys yields nothing.
 *
 *       The one part that cannot be derived is which combinations are worth showing:
 *       commander knows a command takes --params and --link, not that using them
 *       together is the common case. Those are curated here, keyed by command path,
 *       and a test asserts each names a real command.
 * WHEN: By init when it writes armemon/README.md, and by sync when it refreshes it.
 *
 * EXPORTS: buildCommandReference
 * DEPENDS ON: commander (types only)
 * USED BY: packages/cli-armemon/src/commands/init.ts, ./commands/sync.ts
 */

import { JSON_SCHEMA_VERSION } from './jsonOutput.js';
import type { Command } from 'commander';

/**
 * Options that mean the same thing everywhere they appear.
 *
 * Explained once here rather than fifteen times in the tables below, which would
 * bury the flags that are actually specific to a command.
 */
const SHARED = `## Options that work on most commands

Each command below lists exactly which of these it takes.

| Option | What it does |
| --- | --- |
| \`--dry-run\` | Show what would change, but save nothing. Always safe to try |
| \`--dir <path>\` | Run on a different app folder, like \`--dir ./MyApp\` |
| \`--json\` | Print the result as JSON, for scripts and CI |
| \`--all-accept\` | Ask no questions and use the defaults |
| \`--no-verify\` | Skip the checks armemon runs after a change. Faster |
| \`--force\` | Do it even when armemon would normally stop. Each command below says when |
| \`--help\` | Show help for that command in your terminal |

When a command fails, it tells you what went wrong and how to fix it. For more detail,
put \`ARMEMON_DEBUG=1\` in front of the command.

## JSON output, for scripts

With \`--json\`, a command prints one JSON object on stdout and nothing else. Every one
starts with the same two fields:

- \`schemaVersion\` — the version of the output's shape, now \`${JSON_SCHEMA_VERSION}\`. It only changes
  when a field is removed or changes meaning, so skip fields you don't recognise.
- \`ok\` — \`true\` when the command did everything it was asked. The exit code agrees:
  \`0\` when ok, \`1\` for a problem, \`130\` when it was cancelled.

When a command fails, the object is \`{ "ok": false, "error": { "message": "…", "hint": "…" } }\`.
`;

/**
 * Combinations worth showing, by command path.
 *
 * Only what commander cannot know: that these flags are usually reached for together.
 */
const EXAMPLES: Record<string, string[]> = {
  'init react-native': [
    'armemon init react-native MyApp',
    '# every prompt answered with its default, every recommended plugin',
    'armemon init react-native MyApp --all-accept',
    '# pinned for CI, nothing interactive',
    'armemon init react-native MyApp --pm pnpm --language ts --platforms ios,android,web --plugins redux,navigation --json',
    '# see what it would do first',
    'armemon init react-native MyApp --dry-run',
  ],
  add: ['armemon add web', 'armemon add windows --dir ./MyApp', 'armemon add ios --json'],
  'plugin add': [
    'armemon plugin add redux',
    '# see every file, edit and package first',
    'armemon plugin add navigation --dry-run',
    '# default answers, JSON out, for a script',
    'armemon plugin add essentials --json',
    '# the splash screen with your logo',
    'armemon plugin add splash --logo ./assets/logo.png',
  ],
  'plugin remove': [
    'armemon plugin remove redux',
    'armemon plugin remove redux --dry-run',
    "# go ahead past files you've changed — they stay, and are listed",
    'armemon plugin remove ui --force',
  ],
  'plugin list': ['armemon plugin list', 'armemon plugin list --json'],
  'create-screen': [
    'armemon create-screen Order',
    '# typed route params, and a deep link that carries them',
    'armemon create-screen Order --params "id:string,page?:number" --link order/:id',
    '# a modal with a header title, in a stack',
    'armemon create-screen Settings --modal --title Settings',
    '# into a specific navigator, as its first route',
    'armemon create-screen Feed --navigator Tab --initial',
    '# just the file: no subfolders, no navigator, no link',
    'armemon create-screen Order --flat --no-register --no-link',
    '# look before writing, then do it without the checks',
    'armemon create-screen Order --dry-run',
    'armemon create-screen Order --json --no-verify',
  ],
  'remove-screen': [
    'armemon remove-screen Order',
    '# unregister it but keep the folder',
    'armemon remove-screen Order --keep-files',
    '# remove it even though something still navigates to it',
    'armemon remove-screen Order --force',
    'armemon remove-screen Order --dry-run',
  ],
  'rename-screen': [
    'armemon rename-screen Order Invoice',
    '# rename, and give it a new URL at the same time',
    'armemon rename-screen Order Invoice --link invoice/:id',
    '# rename, but leave the deep-link path alone',
    'armemon rename-screen Order Invoice --keep-link',
  ],
  'create-slice': [
    'armemon create-slice cart',
    '# write the file, leave the store config alone',
    'armemon create-slice cart --no-register',
    '# replace a slice file that already exists',
    'armemon create-slice cart --force',
  ],
  'remove-slice': [
    'armemon remove-slice cart',
    '# unregister it but keep the file',
    'armemon remove-slice cart --keep-files',
    '# remove it even though other files still import it',
    'armemon remove-slice cart --force',
  ],
  'rename-slice': [
    'armemon rename-slice cart basket',
    'armemon rename-slice cart basket --dry-run',
  ],
  'create-component': [
    'armemon create-component OrderRow',
    "# into one screen's own components/ folder",
    'armemon create-component OrderRow --screen Order',
    '# into src/shared/components/, for something more than one screen uses',
    'armemon create-component OrderRow --shared',
  ],
  'create-hook': [
    'armemon create-hook useOrderTotals',
    'armemon create-hook useOrderTotals --screen Order',
    'armemon create-hook useSession --shared',
  ],
  'link init': [
    '# for an app scaffolded without deep linking: gives every screen a URL',
    'armemon link init',
    'armemon link init --dry-run',
  ],
  'link list': ['armemon link list', 'armemon link list --json'],
  'link add': [
    'armemon link add Order order/:id',
    '# change the path a route already has',
    'armemon link add Home start',
  ],
  'link remove': ['armemon link remove Order'],
  set: [
    'armemon set ui.themeMode dark',
    'armemon set ui.baseFontSize 18',
    '# a nested option',
    'armemon set essentials.notifications.position bottom',
    '# an expression rather than a literal',
    'armemon set redux.devTools __DEV__ --raw',
    '# replace a value that is currently a function',
    'armemon set redux.middleware undefined --force',
  ],
  upgrade: [
    '# after updating the CLI: npm install -g @armemon-library/cli',
    'armemon upgrade',
    '# see which versions would change first',
    'armemon upgrade --dry-run',
  ],
  sync: [
    'armemon sync',
    '# see what it would re-align first',
    'armemon sync --dry-run',
  ],
  doctor: ['armemon doctor', 'armemon doctor ./MyApp', 'armemon doctor --json'],
  list: ['armemon list', 'armemon list --json'],
};

/**
 * A `|` inside a table cell ends the cell.
 *
 * Descriptions come from commander verbatim, and at least one of them really does
 * contain a pipe — `--language`'s reads "ts | js". Unescaped, that row grows a column
 * and the table is malformed from there down. Nothing in a coverage test notices:
 * the flag is present, the document is just broken around it.
 */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

interface Entry {
  path: string;
  command: Command;
}

function collect(command: Command, prefix: string[], out: Entry[]): void {
  const path = [...prefix, command.name()];
  out.push({ path: path.join(' '), command });
  for (const sub of command.commands) collect(sub, path, out);
}

/** `<name>` when required, `[name]` when not — the same shape commander prints. */
function usage(entry: Entry): string {
  const args = (entry.command.registeredArguments ?? []).map((argument) =>
    argument.required ? `<${argument.name()}>` : `[${argument.name()}]`,
  );
  return `armemon ${entry.path}${args.length > 0 ? ` ${args.join(' ')}` : ''}`;
}

function renderEntry(entry: Entry): string {
  const { command } = entry;
  const lines: string[] = [`### \`${usage(entry)}\``, ''];

  const description = command.description();
  if (description) lines.push(description, '');

  const subcommands = command.commands;
  if (subcommands.length > 0) {
    lines.push('| Subcommand | What it does |', '| --- | --- |');
    for (const sub of subcommands) {
      lines.push(`| \`${entry.path} ${sub.name()}\` | ${cell(sub.description())} |`);
    }
    lines.push('');
  }

  const args = command.registeredArguments ?? [];
  if (args.length > 0) {
    lines.push('| Argument | What it is |', '| --- | --- |');
    for (const argument of args) {
      const name = argument.required ? `<${argument.name()}>` : `[${argument.name()}]`;
      const required = argument.required ? '' : ' *(optional — you are asked if you leave it out)*';
      lines.push(`| \`${name}\` | ${cell(argument.description || '—')}${required} |`);
    }
    lines.push('');
  }

  if (command.options.length > 0) {
    lines.push('| Flag | What it does |', '| --- | --- |');
    for (const option of command.options) {
      lines.push(`| \`${option.flags}\` | ${cell(option.description)} |`);
    }
    lines.push('');
  }

  const examples = EXAMPLES[entry.path];
  if (examples) {
    lines.push('```bash', ...examples, '```', '');
  }

  return lines.join('\n');
}

/**
 * The reference, built from the program as registered.
 *
 * Takes the root program rather than importing it, so this module stays free of the
 * command/flow import graph it documents.
 */
export function buildCommandReference(program: Command): string {
  const entries: Entry[] = [];
  for (const command of program.commands) collect(command, [], entries);

  const contents = entries
    .filter((entry) => !entry.path.includes(' '))
    .map((entry) => `- \`armemon ${entry.path}\` — ${entry.command.description()}`)
    .join('\n');

  return `
---

# All commands and options

This list is made from the armemon CLI itself, so it always matches the version you have.

## Quick list

${contents}

${SHARED}
## Commands

${entries.map(renderEntry).join('\n')}`;
}
