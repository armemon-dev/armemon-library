/**
 * FILE: nativeIdentifiers.ts
 * PATH: packages/cli-kit/src/fs/nativeIdentifiers.ts
 *
 * WHAT: Reads the bundle identifier / application id the React Native CLI actually
 *       wrote into the scaffolded native projects.
 * WHY:  The advanced-init step used to RECONSTRUCT this as
 *       `org.reactjs.native.<appname>` and compare the user's answer against it. That
 *       string matches neither platform: the RN CLI generates
 *       `org.reactjs.native.example.<AppName>` for iOS and `com.<appname>` for
 *       Android. So the "your identifier differs from the default" note fired on
 *       correct answers and stayed silent on wrong ones, and the two platforms were
 *       never reconciled. Reading the real values costs two regexes and is right by
 *       construction.
 * HOW:  Greps `applicationId "…"` out of android/app/build.gradle and
 *       PRODUCT_BUNDLE_IDENTIFIER out of the iOS pbxproj (taking the first match —
 *       the template repeats the same value across build configurations). Returns
 *       null per platform when the folder isn't there, which is normal: platform
 *       cleanup deletes unselected native projects.
 * WHEN: Called by the advanced-init wizard to seed and validate its bundle-id
 *       question.
 *
 * EXPORTS: readNativeIdentifiers, NativeIdentifiers
 * DEPENDS ON: node:path, node:fs/promises
 * USED BY: packages/builtin-advanced-init/src/wizard/**
 */

import path from 'node:path';
import fs from 'node:fs/promises';

export interface NativeIdentifiers {
  ios: string | null;
  android: string | null;
}

async function readIfPresent(filePath: string): Promise<string | null> {
  return fs.readFile(filePath, 'utf8').catch(() => null);
}

async function findPbxproj(appRoot: string): Promise<string | null> {
  const iosDir = path.join(appRoot, 'ios');
  const entries = await fs.readdir(iosDir).catch(() => null);
  if (!entries) return null;

  const projectDir = entries.find((entry) => entry.endsWith('.xcodeproj'));
  if (!projectDir) return null;

  return path.join(iosDir, projectDir, 'project.pbxproj');
}

export async function readNativeIdentifiers(appRoot: string): Promise<NativeIdentifiers> {
  const gradle = await readIfPresent(path.join(appRoot, 'android', 'app', 'build.gradle'));
  const android = gradle?.match(/applicationId\s+["']([^"']+)["']/)?.[1] ?? null;

  const pbxprojPath = await findPbxproj(appRoot);
  const pbxproj = pbxprojPath ? await readIfPresent(pbxprojPath) : null;
  const rawIos =
    pbxproj?.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";\n]+)"?;/)?.[1]?.trim() ?? null;

  // The RN template's iOS identifier contains an Xcode build variable
  // (org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)). That expands at
  // build time, so comparing a user's answer against the literal string is
  // meaningless and produced a "differs from the default" warning on every run.
  const ios = rawIos && rawIos.includes('$(') ? null : rawIos;

  return { ios, android };
}
