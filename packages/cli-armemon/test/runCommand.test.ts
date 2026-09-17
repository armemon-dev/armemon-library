/**
 * FILE: runCommand.test.ts
 * PATH: packages/cli-armemon/test/runCommand.test.ts
 *
 * WHAT: The exit codes every command ends with.
 * WHY:  A cancel exited 1, the same as a failure, so a script couldn't tell "the
 *       user stopped it" from "it broke". 130 is what shells use for Ctrl-C.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelledError, CliError } from '@armemon-library/cli-kit';
import { runCommand } from '../src/runCommand';
import { resetCliState } from './support/screenApps';

afterEach(() => {
  resetCliState();
  vi.restoreAllMocks();
});

describe('runCommand exit codes', () => {
  it('exits 130 when the run was cancelled', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCommand(async () => {
      throw new CancelledError();
    });
    expect(process.exitCode).toBe(130);
  });

  it('exits 130 for a cancel under --json too, and says so in the JSON', async () => {
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    await runCommand(
      async () => {
        throw new CancelledError();
      },
      { json: true },
    );
    expect(process.exitCode).toBe(130);
    expect(JSON.parse(written.join(''))).toEqual({ schemaVersion: 1, ok: false, error: { message: 'Cancelled.' } });
  });

  it('exits 1 for a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runCommand(async () => {
      throw new CliError('Something broke.', 'Fix it.');
    });
    expect(process.exitCode).toBe(1);
  });
});
