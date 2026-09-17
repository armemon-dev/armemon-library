/**
 * FILE: screenShared.ts
 * PATH: packages/cli-armemon/src/flows/screenShared.ts
 *
 * WHAT: What create-screen, remove-screen and rename-screen share: finding the app,
 *       staging edits in memory, committing them all-or-nothing, verifying, and
 *       reporting — as prose, as a dry-run diff, or as JSON.
 * WHY:  The first create-screen wrote the screen and then edited three files one at a
 *       time, straight to disk. When an edit broke a file the damage was done before
 *       anything could notice, and verification only described it afterwards. Now
 *       every change is computed and parse-checked before the first byte is written,
 *       and a failure while writing puts every file back the way it was.
 * HOW:  A ChangeSet holds each touched file's original and staged content plus a
 *       report line per edit. `commit` applies moves, new files and edits, keeping an
 *       undo step for each; folder deletions, which can't be undone, run last and
 *       only after everything else landed. `emit` prints the JSON summary and sets
 *       the exit code: 1 when an edit had to be skipped or the checks fail.
 * WHEN: Used by the three screen flows.
 *
 * EXPORTS: ScreenCommandOptions, EditStatus, EditOutcome, ChangeSet, applyOutputMode,
 *          openApp, pathExists, isInside, moduleSpecifier, filesUnder, indexFiles,
 *          commit, lineDiff, printChanges, printOutcomes, verifyApp, errorsInChangedFiles,
 *          verificationSummary, printVerification, emit
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/cli-kit, @armemon-library/config-types
 * USED BY: ./createScreen.ts, ./removeScreen.ts, ./renameScreen.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  CliError,
  findAppRoot,
  formatManagedSource,
  getLogStream,
  logger,
  readAppConfig,
  readLayout,
  setAutoAccept,
  setLogStream,
  verifyGeneratedApp,
  withSpinner,
  type PatchResult,
  type VerificationReport,
} from '@armemon-library/cli-kit';
import { isManaged, type AppLayout, type ArmemonAppConfig } from '@armemon-library/config-types';
import { writeJson } from '../jsonOutput.js';

export interface ScreenCommandOptions {
  cwd: string;
  dir?: string;
  /** Compute and show every change, write nothing. */
  dryRun?: boolean;
  /** Only JSON on stdout; implies allAccept. */
  json?: boolean;
  allAccept?: boolean;
  /** Type-check and build afterwards. On by default; off is for speed. */
  verify?: boolean;
}

export type EditStatus = 'changed' | 'already' | 'skipped' | 're-aligned';

export interface EditOutcome {
  /** App-relative, forward slashes. */
  file: string;
  status: EditStatus;
  /** What was done, for a changed edit. */
  action?: string;
  /** Why nothing changed. */
  reason?: string;
  /** What to do by hand, for a skipped edit. */
  manual?: string;
}

/** --json is for scripts: nothing but JSON on stdout, and no questions. */
export function applyOutputMode(options: { json?: boolean; allAccept?: boolean }): void {
  if (options.allAccept || options.json) setAutoAccept(true);
  if (options.json) setLogStream('stderr');
}

/**
 * --dir exactly, or the nearest app at or above the current directory.
 *
 * The layout comes back with it so every command reads the managed zone's location
 * once, from the app itself, instead of each caller assuming one.
 */
export async function openApp(
  options: ScreenCommandOptions,
): Promise<{ appRoot: string; config: ArmemonAppConfig; layout: AppLayout }> {
  const start = path.resolve(options.cwd, options.dir ?? '.');
  const appRoot = options.dir ? start : ((await findAppRoot(start)) ?? start);
  return { appRoot, config: await readAppConfig(appRoot), layout: await readLayout(appRoot) };
}

export async function pathExists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true).catch(() => false);
}

export function isInside(file: string, folder: string): boolean {
  return file === folder || file.startsWith(`${folder}${path.sep}`);
}

/** The import specifier `fromFile` uses to reach `toFile`: extensionless, no /index. */
export function moduleSpecifier(fromFile: string, toFile: string): string {
  const spec = path
    .relative(path.dirname(fromFile), toFile)
    .split(path.sep)
    .join('/')
    .replace(/\.[jt]sx?$/, '')
    .replace(/\/index$/, '');
  return spec.startsWith('.') ? spec : `./${spec}`;
}

export async function filesUnder(folder: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else found.push(full);
  }
  return found;
}

/** Every index file a screen folder has. Two shadow each other: Metro resolves .js before .tsx. */
export async function indexFiles(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const extension of ['tsx', 'jsx', 'ts', 'js']) {
    const candidate = path.join(folder, `index.${extension}`);
    if (await pathExists(candidate)) found.push(candidate);
  }
  return found;
}

interface StagedFile {
  before: string | null;
  after: string;
}

export class ChangeSet {
  readonly outcomes: EditOutcome[] = [];
  private readonly staged = new Map<string, StagedFile>();
  /**
   * What each file held on disk the first time this run looked. A command works out
   * every edit before writing any, so the disk doesn't change underneath it — and
   * remove-screen's barrel scan asked for the same files once per exported name per
   * barrel, re-reading every one each time.
   */
  private readonly disk = new Map<string, Promise<string | null>>();

  constructor(readonly appRoot: string) {}

  relative(file: string): string {
    return path.relative(this.appRoot, file).split(path.sep).join('/');
  }

  private fromDisk(file: string): Promise<string | null> {
    let content = this.disk.get(file);
    if (!content) {
      content = fs.readFile(file, 'utf8').catch(() => null);
      this.disk.set(file, content);
    }
    return content;
  }

  /** The content a later edit should build on: staged if already edited, else disk. */
  async read(file: string): Promise<string | null> {
    const staged = this.staged.get(file);
    if (staged) return staged.after;
    return this.fromDisk(file);
  }

  /**
   * `before` is what a failed commit restores. It is read from disk unless given —
   * which a file that moves with its folder needs, since it isn't at `file` yet.
   */
  async stage(file: string, content: string, before?: string | null): Promise<void> {
    const existing = this.staged.get(file);
    if (existing) {
      existing.after = content;
      return;
    }
    const original = before !== undefined ? before : await this.fromDisk(file);
    this.staged.set(file, { before: original, after: content });
  }

  record(outcome: EditOutcome): void {
    this.outcomes.push(outcome);
  }

  /**
   * Brings a managed file back to canonical shape before anything edits it.
   *
   * armemon re-reads and re-edits everything in the managed zone on every command,
   * and the user is allowed to open those files. A hand-edit that leaves a file
   * valid but differently shaped is what the parser-backed edits cope with worst —
   * so re-align first, and every patch in this run then builds on canonical text.
   *
   * It is reported rather than done silently: a reformat the user didn't ask for,
   * showing up unexplained next to their own change, is worse than one that says so.
   * Only managed files: reformatting the author's screens is not armemon's call.
   */
  async realign(file: string, layout: AppLayout): Promise<void> {
    if (!isManaged(layout, this.relative(file))) return;

    const content = await this.read(file);
    if (content === null) return;

    const formatted = await formatManagedSource(content, file);
    if (formatted === content) return;

    await this.stage(file, formatted);
    this.record({ file: this.relative(file), status: 're-aligned', action: 're-aligned formatting' });
  }

  skip(file: string, reason: string, manual?: string): void {
    this.record({ file: this.relative(file), status: 'skipped', reason, ...(manual ? { manual } : {}) });
  }

  /** Runs a patch against the current content and stages the result. */
  async patch(
    file: string,
    patch: (content: string) => PatchResult,
    options: { action: string | ((result: PatchResult) => string); reportAlready?: boolean },
  ): Promise<PatchResult & { status: EditStatus }> {
    const content = await this.read(file);
    if (content === null) {
      const reason = `${this.relative(file)} doesn't exist`;
      this.skip(file, reason);
      return { content: '', changed: false, reason, status: 'skipped' };
    }

    const result = patch(content);
    const status: EditStatus = result.changed ? 'changed' : result.already ? 'already' : 'skipped';
    if (result.changed) await this.stage(file, result.content);
    if (status !== 'already' || options.reportAlready !== false) {
      this.record({
        file: this.relative(file),
        status,
        ...(status === 'changed'
          ? { action: typeof options.action === 'function' ? options.action(result) : options.action }
          : { reason: result.reason }),
        ...(status === 'skipped' && result.manual ? { manual: result.manual } : {}),
      });
    }
    return { ...result, status };
  }

  get changes(): Array<{ file: string } & StagedFile> {
    return [...this.staged.entries()]
      .filter(([, staged]) => staged.before !== staged.after)
      .map(([file, staged]) => ({ file, ...staged }));
  }
}

/**
 * Re-aligns every managed file a command is about to edit, before it edits any of
 * them.
 *
 * Callers pass whatever they have — a navigator that turns out to live in the
 * author's zone, a param list that doesn't exist, a linking file that is null —
 * and this drops the ones that aren't managed files. That keeps the decision about
 * what armemon owns in one place instead of at three call sites.
 */
export async function realignManaged(
  changes: ChangeSet,
  layout: AppLayout,
  files: Array<string | null | undefined>,
): Promise<void> {
  const unique = new Set(files.filter((file): file is string => typeof file === 'string'));
  for (const file of unique) await changes.realign(file, layout);
}

export interface CommitPlan {
  /** New files, relative to the app. An existing file is overwritten, and restored on failure. */
  create?: Array<{ path: string; content: string }>;
  /** Folders to move before any edit is written: [from, to], absolute. */
  moves?: Array<[string, string]>;
  /** Folders to delete once everything else has landed. */
  removeFolders?: string[];
  /** Files to delete; put back if anything fails. */
  deleteFiles?: string[];
}

/**
 * Writes everything, or — if any write fails — puts everything back.
 *
 * Returns the undo for a failure that comes after the writes: `armemon plugin add`
 * installs packages once the files are down, and an install that fails has to leave
 * the app as it found it. Folders in `removeFolders` are gone for good.
 */
export async function commit(changes: ChangeSet, plan: CommitPlan = {}): Promise<{ rollback: () => Promise<void> }> {
  const undo: Array<() => Promise<void>> = [];

  try {
    for (const [from, to] of plan.moves ?? []) {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      undo.push(() => fs.rename(to, from));
    }

    for (const file of plan.create ?? []) {
      const full = path.join(changes.appRoot, file.path);
      const previous = await fs.readFile(full, 'utf8').catch(() => null);
      const createdFolder = await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, file.content, 'utf8');
      undo.push(async () => {
        if (previous === null) await fs.rm(full, { force: true });
        else await fs.writeFile(full, previous, 'utf8');
        if (createdFolder) await fs.rm(createdFolder, { recursive: true, force: true });
      });
    }

    for (const file of plan.deleteFiles ?? []) {
      const previous = await fs.readFile(file).catch(() => null);
      if (previous === null) continue;
      await fs.rm(file);
      undo.push(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, previous);
      });
    }

    for (const { file, before, after } of changes.changes) {
      // A staged file can be new, in a folder that doesn't exist yet. Every caller so
      // far staged into existing folders, which is the only reason this ever worked.
      const createdFolder = await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, after, 'utf8');
      undo.push(async () => {
        if (before === null) await fs.rm(file, { force: true });
        else await fs.writeFile(file, before, 'utf8');
        if (createdFolder) await fs.rm(createdFolder, { recursive: true, force: true });
      });
    }
  } catch (error) {
    for (const step of undo.reverse()) await step().catch(() => undefined);
    throw new CliError(
      `Couldn't finish writing, so every change was put back: ${error instanceof Error ? error.message : String(error)}`,
      'Nothing in the app changed. Check the file permissions, then run it again.',
    );
  }

  // Can't be undone, so only once everything above has landed.
  for (const folder of plan.removeFolders ?? []) await fs.rm(folder, { recursive: true, force: true });

  return {
    rollback: async () => {
      for (const step of [...undo].reverse()) await step().catch(() => undefined);
    },
  };
}

/**
 * The most table cells a diff may use: 4 bytes each, so about 8 MB. Above that the
 * preview says so rather than holding a whole run's memory for one file.
 */
const MAX_DIFF_CELLS = 2_000_000;

/**
 * Added and removed lines, numbered, via a longest-common-subsequence walk.
 *
 * The lines both versions share at the start and the end are set aside first. An
 * armemon edit is a few lines somewhere in a file, so what is left to compare is
 * tiny — where comparing the whole of two long files used to allocate a table of up
 * to 100 MB to show a two-line change.
 */
export function lineDiff(before: string, after: string): string[] {
  const allA = before.length > 0 ? before.split(/\r?\n/) : [];
  const allB = after.split(/\r?\n/);

  let start = 0;
  while (start < allA.length && start < allB.length && allA[start] === allB[start]) start += 1;
  let end = 0;
  while (
    end < allA.length - start &&
    end < allB.length - start &&
    allA[allA.length - 1 - end] === allB[allB.length - 1 - end]
  ) {
    end += 1;
  }

  const a = allA.slice(start, allA.length - end);
  const b = allB.slice(start, allB.length - end);
  if ((a.length + 1) * (b.length + 1) > MAX_DIFF_CELLS) return ['(too large to preview)'];

  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }

  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (j < b.length && (i === a.length || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)) {
      lines.push(`+ ${String(start + j + 1).padStart(4)} │ ${b[j]}`);
      j += 1;
    } else {
      lines.push(`- ${String(start + i + 1).padStart(4)} │ ${a[i]}`);
      i += 1;
    }
  }
  return lines;
}

const print = (line: string) => (getLogStream() === 'stderr' ? console.error(line) : console.log(line));

export function printChanges(changes: ChangeSet, created: string[] = []): void {
  for (const file of created) logger.info(`Would create ${file}`);
  for (const { file, before, after } of changes.changes) {
    logger.info(`Would edit ${changes.relative(file)}`);
    for (const line of lineDiff(before ?? '', after)) print(`    ${line}`);
  }
}

export function printOutcomes(changes: ChangeSet, options: { onlyProblems?: boolean } = {}): void {
  for (const outcome of changes.outcomes) {
    if (outcome.status === 'changed' && !options.onlyProblems) logger.success(`${outcome.file} — ${outcome.action}.`);
    if (outcome.status === 'already' && !options.onlyProblems) logger.info(`${outcome.file} — ${outcome.reason}.`);
    if (outcome.status === 're-aligned' && !options.onlyProblems) logger.info(`${outcome.file} — ${outcome.action}.`);
    if (outcome.status === 'skipped') {
      logger.warn(`${outcome.file} — not changed: ${outcome.reason}.`);
      if (outcome.manual) {
        print('    By hand:');
        for (const line of outcome.manual.split('\n')) print(`      ${line}`);
      }
    }
  }
}

export async function verifyApp(
  appRoot: string,
  config: ArmemonAppConfig,
  options: ScreenCommandOptions,
): Promise<VerificationReport | null> {
  // A new screen can break the type-check — an unused import, a route name that
  // doesn't match the param list — and finding out on the next build is exactly what
  // these checks prevent. They are the slow part, so --no-verify is there for loops.
  if (options.verify === false || options.dryRun) return null;
  return withSpinner('Checking the app still works…', () =>
    verifyGeneratedApp({
      appRoot,
      isTypeScript: config.language !== 'javascript',
      hasWeb: (config.platforms as string[]).includes('web'),
      packageManager: config.packageManager,
    }),
  );
}

/**
 * Whether a failed check points at what the command touched: it names one of those
 * files, or can't say where it failed (a web build does not). Null when nothing failed.
 */
export function errorsInChangedFiles(verification: VerificationReport, touched: string[]): boolean | null {
  const failed = verification.checks.filter((check) => !check.ok);
  if (failed.length === 0) return null;
  return failed.some((check) => !check.files || check.files.some((file) => touched.includes(file)));
}

export function verificationSummary(verification: VerificationReport | null, touched: string[]) {
  return verification
    ? { ok: verification.ok, checks: verification.checks, inChangedFiles: errorsInChangedFiles(verification, touched) }
    : null;
}

/**
 * The type-check covers the whole app, so a failure isn't necessarily this command's:
 * the undo hint is only offered when the errors are in files it touched.
 */
export function printVerification(
  verification: VerificationReport | null,
  options: { touched: string[]; undoHint?: string },
): void {
  if (!verification || verification.ok) return;
  logger.warn("armemon's checks found problems after the change:");
  for (const check of verification.checks.filter((entry) => !entry.ok)) logger.warn(`  ${check.name}: ${check.detail}`);
  if (errorsInChangedFiles(verification, options.touched)) {
    if (options.undoHint) logger.info(options.undoHint);
  } else {
    logger.info(
      'None of these errors are in a file this command created or edited. They may have been there already — or come from code that still uses a route this changed.',
    );
  }
}

/** The JSON summary on stdout, when asked for, and the exit code either way. */
export function emit(summary: { ok: boolean } & Record<string, unknown>, options: { json?: boolean }): void {
  if (options.json) writeJson(summary);
  if (!summary.ok) process.exitCode = 1;
}
