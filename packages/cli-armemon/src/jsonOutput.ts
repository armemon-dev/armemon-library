/**
 * FILE: jsonOutput.ts
 * PATH: packages/cli-armemon/src/jsonOutput.ts
 *
 * WHAT: The one place any command writes its `--json` result.
 * WHY:  Scripts read these, and there was no contract: most outputs had `ok`, init's
 *       didn't, `list` printed a bare array, and nothing said which version of a shape
 *       a script was looking at. So every output is now one object with the same two
 *       fields first — `schemaVersion` and `ok` — whatever else the command adds.
 * HOW:  `schemaVersion` changes only when a field is removed, renamed or changes
 *       meaning. Adding a field doesn't change it, so a script should ignore fields it
 *       doesn't know. The generated command reference documents the envelope.
 * WHEN: Every `--json` result, success or failure.
 *
 * EXPORTS: JSON_SCHEMA_VERSION, writeJson
 * DEPENDS ON: nothing
 * USED BY: runCommand.ts, index.ts, flows/screenShared.ts, flows/initReactNative.ts,
 *          commands/list.ts, commands/doctor.ts
 */

export const JSON_SCHEMA_VERSION = 1;

export function writeJson(summary: { ok: boolean } & Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, ...summary }, null, 2)}\n`);
}
