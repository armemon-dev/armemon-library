/**
 * FILE: componentScaffold.test.ts
 * PATH: packages/cli-kit/test/componentScaffold.test.ts
 *
 * WHAT: Naming and placing a component or a hook, and the files written for them.
 * WHY:  Both names carry a rule that is enforced by React rather than by the type
 *       checker, so getting one wrong fails at runtime or — worse — silently: a
 *       lowercase component name is read by JSX as an HTML tag, and a hook not named
 *       useSomething gets none of the rules-of-hooks checks that would catch a
 *       conditional call.
 *
 *       Placement is the other half. These commands create a file and wire nothing,
 *       so the only decision they make for you is which folder — and it has to match
 *       the layout the screen READMEs describe, or the guidance and the tool disagree.
 */
import { describe, expect, it } from 'vitest';
import {
  buildComponentFile,
  buildHookFile,
  targetFolder,
  validateComponentName,
  validateHookName,
} from '../dist/index.js';

const screen = { kind: 'screen', routeName: 'Order' } as const;
const shared = { kind: 'shared' } as const;

describe('names', () => {
  it('requires a component to be capitalised, because JSX reads lowercase as HTML', () => {
    expect(validateComponentName('OrderRow')).toBeUndefined();
    expect(validateComponentName('orderRow')).toMatch(/capital letter/);
  });

  it('requires a hook to start with use, because that is what React keys its rules to', () => {
    expect(validateHookName('useOrderTotals')).toBeUndefined();
    expect(validateHookName('orderTotals')).toMatch(/useSomething/);
    // `use` alone is the degenerate case.
    expect(validateHookName('use')).toMatch(/useSomething/);
  });
});

describe('placement', () => {
  it("puts a screen's own parts in that screen's folder", () => {
    expect(targetFolder(screen, 'components')).toBe('src/screens/OrderScreen/components');
    expect(targetFolder(screen, 'hooks')).toBe('src/screens/OrderScreen/hooks');
  });

  it('puts shared parts in the shared folder', () => {
    expect(targetFolder(shared, 'components')).toBe('src/shared/components');
    expect(targetFolder(shared, 'hooks')).toBe('src/shared/hooks');
  });
});

describe('buildComponentFile', () => {
  it('writes into the screen folder and exports the component', () => {
    const { path, content } = buildComponentFile({
      name: 'OrderRow',
      placement: screen,
      language: 'typescript',
    });

    expect(path).toBe('src/screens/OrderScreen/components/OrderRow.tsx');
    expect(content).toContain('export default function OrderRow(');
    expect(content).toContain('export interface OrderRowProps');
  });

  it('says where it would move to once a second screen needs it', () => {
    const { content } = buildComponentFile({
      name: 'OrderRow',
      placement: screen,
      language: 'typescript',
    });
    expect(content).toContain('src/shared/components/');
  });

  it('names no TypeScript in a JavaScript app', () => {
    const { path, content } = buildComponentFile({
      name: 'OrderRow',
      placement: shared,
      language: 'javascript',
    });

    expect(path).toBe('src/shared/components/OrderRow.jsx');
    expect(content).not.toContain('interface');
    expect(content).not.toMatch(/:\s*OrderRowProps/);
  });
});

describe('buildHookFile', () => {
  it('writes into the hooks folder and exports the hook by name', () => {
    const { path, content } = buildHookFile({
      name: 'useOrderTotals',
      placement: screen,
      language: 'typescript',
    });

    expect(path).toBe('src/screens/OrderScreen/hooks/useOrderTotals.ts');
    expect(content).toContain('export function useOrderTotals()');
  });

  it('takes the app extension in a JavaScript app', () => {
    expect(
      buildHookFile({ name: 'useOrderTotals', placement: shared, language: 'javascript' }).path,
    ).toBe('src/shared/hooks/useOrderTotals.js');
  });

  it('is not imported anywhere, and says so', () => {
    const { content } = buildHookFile({
      name: 'useOrderTotals',
      placement: shared,
      language: 'typescript',
    });
    expect(content).toContain('not imported anywhere yet');
  });
});
