/**
 * FILE: componentScaffold.ts
 * PATH: packages/cli-kit/src/codegen/componentScaffold.ts
 *
 * WHAT: The files `armemon create-component` and `armemon create-hook` write, and the
 *       rules for what they may be called.
 * WHY:  These two commands deliberately do LESS than the others: they create a file
 *       and stop. Nothing is registered, nothing is imported, no managed file is
 *       touched — because a component belongs wherever the person writing it decides,
 *       and guessing that wrong is worse than not guessing. The value is the folder
 *       decision (this screen's, or shared) and a file that already has the shape the
 *       rest of the app uses.
 * HOW:  Same placement rule the screen READMEs state: something lives with the one
 *       screen that uses it until a SECOND screen needs it, then it moves to shared.
 *       The generated file says so, since that is when the reader will be deciding.
 * WHEN: `armemon create-component` and `armemon create-hook`.
 *
 * EXPORTS: COMPONENT_NAME_PATTERN, HOOK_NAME_PATTERN, validateComponentName,
 *          validateHookName, ComponentTarget, buildComponentFile, buildHookFile
 * DEPENDS ON: @armemon-library/config-types
 * USED BY: packages/cli-armemon/src/flows/createComponent.ts
 */

import { SCREENS_DIR, SHARED_DIR, type AppLanguage } from '@armemon-library/config-types';

/** A component is a JSX tag, so it has to be capitalised or React treats it as HTML. */
export const COMPONENT_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

/** React only applies the rules of hooks to a function whose name starts with `use`. */
export const HOOK_NAME_PATTERN = /^use[A-Z][A-Za-z0-9]*$/;

export function validateComponentName(value: string): string | undefined {
  if (!COMPONENT_NAME_PATTERN.test(value)) {
    return 'Start with a capital letter and use letters and numbers only, e.g. OrderRow — lowercase names are read as HTML tags by JSX.';
  }
  return undefined;
}

export function validateHookName(value: string): string | undefined {
  if (!HOOK_NAME_PATTERN.test(value)) {
    return 'Name it useSomething, e.g. useOrderTotals — React only applies the rules of hooks to functions named that way.';
  }
  return undefined;
}

export interface ComponentTarget {
  /** The exported name: OrderRow, or useOrderTotals. */
  name: string;
  /**
   * Where it goes. Either a screen's own folder, or the shared one — the two places
   * the folder layout has for it.
   */
  placement: { kind: 'screen'; routeName: string } | { kind: 'shared' };
  language: AppLanguage;
}

/** The folder a component or hook belongs in, given where it was placed. */
export function targetFolder(
  placement: ComponentTarget['placement'],
  kind: 'components' | 'hooks',
): string {
  return placement.kind === 'screen'
    ? `${SCREENS_DIR}/${placement.routeName}Screen/${kind}`
    : `${SHARED_DIR}/${kind}`;
}

/** Where it lives now, and where it would move to — the sentence both files end on. */
function placementNote(placement: ComponentTarget['placement'], kind: 'components' | 'hooks'): string {
  return placement.kind === 'screen'
    ? ` * This belongs to ${placement.routeName}Screen alone. The moment a SECOND screen needs
 * it, move it to ${SHARED_DIR}/${kind}/ — that is the rule that keeps one screen's
 * detail from becoming everyone's problem.`
    : ` * This is shared, so more than one screen is expected to use it. If it turns out
 * only one does, it belongs in that screen's own ${kind}/ folder instead, where it
 * gets deleted along with the screen.`;
}

export function buildComponentFile(target: ComponentTarget): { path: string; content: string } {
  const { name, placement, language } = target;
  const extension = language === 'javascript' ? 'jsx' : 'tsx';
  const folder = targetFolder(placement, 'components');
  const typed = language !== 'javascript';

  const content = `import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/**
 * FILE: ${name}.${extension}
 * PATH: ${folder}/${name}.${extension}
 *
 * WHAT: ${name} — replace this with what it actually renders.
 * WHY:  armemon created the file and nothing else. It is not imported anywhere yet:
 *       import it where you need it.
 *
${placementNote(placement, 'components')}
 */
${typed ? `export interface ${name}Props {\n  label?: string;\n}\n\n` : ''}export default function ${name}({ label = '${name}' }${typed ? `: ${name}Props` : ''}) {
  return (
    <View style={styles.container}>
      <Text>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
});
`;

  return { path: `${folder}/${name}.${extension}`, content };
}

export function buildHookFile(target: ComponentTarget): { path: string; content: string } {
  const { name, placement, language } = target;
  const extension = language === 'javascript' ? 'js' : 'ts';
  const folder = targetFolder(placement, 'hooks');

  const content = `import { useCallback, useState } from 'react';

/**
 * FILE: ${name}.${extension}
 * PATH: ${folder}/${name}.${extension}
 *
 * WHAT: ${name} — replace this with the state or data it actually owns.
 * WHY:  armemon created the file and nothing else. It is not imported anywhere yet:
 *       import it where you need it.
 * HOW:  Returns data rather than setters where it can. A hook that hands back
 *       \`setThing\` has moved the decision to the caller; one that hands back
 *       \`addThing()\` keeps the rule in one place.
 *
${placementNote(placement, 'hooks')}
 */
export function ${name}() {
  const [value, setValue] = useState${language === 'javascript' ? '' : '<unknown>'}(null);

  const reset = useCallback(() => {
    setValue(null);
  }, []);

  return { value, reset };
}
`;

  return { path: `${folder}/${name}.${extension}`, content };
}
