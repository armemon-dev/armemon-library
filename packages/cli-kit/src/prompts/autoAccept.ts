/**
 * FILE: autoAccept.ts
 * PATH: packages/cli-kit/src/prompts/autoAccept.ts
 *
 * WHAT: A module-level flag every prompt wrapper checks before ever rendering a
 *       real interactive prompt — the entire mechanism behind `armemon init
 *       react-native --all-accept`.
 * WHY:  A module-level flag (not a WizardContext field) because the top-level
 *       appName/platform/package-manager questions run BEFORE any WizardContext
 *       exists — threading a boolean through every call site instead of through the
 *       prompt wrapper functions themselves would mean retrofitting dozens of call
 *       sites across every plugin's wizard, which this design specifically avoids.
 *       Living in cli-kit means every one of the four prompt wrappers
 *       (text/select/confirm/multiselect) can check it at the very top, before
 *       calling into @clack/prompts at all.
 * HOW:  Plain mutable module state — deliberately not a class or a more elaborate
 *       pattern, since this needs exactly one flag, set once, read many times.
 * WHEN: `setAutoAccept(true)` is called once, at the very start of
 *       runInitReactNativeFlow, before any prompt fires; `isAutoAcceptEnabled()` is
 *       read by every prompt wrapper on every call.
 *
 * EXPORTS: setAutoAccept, isAutoAcceptEnabled
 * DEPENDS ON: nothing
 * USED BY: packages/cli-kit/src/prompts/{text,select,confirm,multiselect}.ts,
 *          packages/cli-armemon/src/flows/initReactNative.ts,
 *          packages/plugin-navigation/src/wizard/questions.ts
 */

let autoAcceptEnabled = false;

export function setAutoAccept(enabled: boolean): void {
  autoAcceptEnabled = enabled;
}

export function isAutoAcceptEnabled(): boolean {
  return autoAcceptEnabled;
}
