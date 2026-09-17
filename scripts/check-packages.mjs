/**
 * Checks every workspace package the way a consumer would meet it: publint for the
 * package.json and exports map, arethetypeswrong for what TypeScript actually
 * resolves under each module setting.
 *
 * Both run against the packed tarball, so what they see is what npm would publish.
 * They caught a real problem the tests couldn't: every dual CJS/ESM runtime package
 * pointed its ESM entry at CommonJS type declarations.
 *
 * Two findings are by design, so they are not failures here:
 * - `cjs-resolves-to-esm`: the CLI, cli-kit and config-types are ESM-only Node tools,
 *   and every plugin's ./wizard entry is ESM-only and loaded only by the CLI.
 * - node10 resolution: it ignores `exports`, and only the CLI loads ./wizard.
 *
 * Run after building:  npm run check:packages
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin = (name) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);

const packages = fs
  .readdirSync(path.join(root, 'packages'))
  .map((dir) => path.join('packages', dir))
  .filter((dir) => fs.existsSync(path.join(root, dir, 'package.json')))
  .filter((dir) => !JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8')).private);

const failures = [];

for (const dir of packages) {
  const checks = [
    ['publint', [bin('publint'), ['--strict', dir]]],
    [
      'arethetypeswrong',
      [bin('attw'), ['--pack', dir, '--profile', 'node16', '--ignore-rules', 'cjs-resolves-to-esm', '--format', 'ascii']],
    ],
  ];

  for (const [name, [command, args]] of checks) {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    if (result.status !== 0) {
      failures.push(`${dir} — ${name}`);
      process.stdout.write(`\n✖ ${dir} — ${name}\n${result.stdout}${result.stderr}\n`);
    } else {
      process.stdout.write(`✔ ${dir} — ${name}\n`);
    }
  }
}

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} check(s) failed:\n${failures.map((entry) => `  ${entry}`).join('\n')}\n`);
  process.exit(1);
}
