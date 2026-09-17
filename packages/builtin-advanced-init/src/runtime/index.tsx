/**
 * FILE: index.tsx
 * PATH: packages/builtin-advanced-init/src/runtime/index.tsx
 *
 * WHAT: The AdvancedInitPlugin runtime object — contributes no observable behavior at
 *       app runtime (its work — env files, path aliases, bundle id notes, lint style —
 *       is all done once at scaffold time by the wizard, not on every app launch). It
 *       still needs a pass-through provider to satisfy the uniform RuntimePluginObject
 *       contract that both the task engine and the provider chain iterate over.
 * WHY:  Keeping this a real (if inert) plugin object — rather than special-casing
 *       "provider-less plugins" throughout core — keeps runtime.generated.ts codegen
 *       and the provider-composition logic uniform: every entry in `plugins[]` has a
 *       provider, full stop.
 * HOW:  A trivial fragment-wrapping provider; empty tasks array.
 * WHEN: Registered like any other plugin in runtime.generated.ts.
 *
 * EXPORTS: AdvancedInitPlugin
 * DEPENDS ON: react, @armemon-library/config-types
 * USED BY: generated armemon/runtime.generated.ts
 */

import React, { type ReactElement, type ReactNode } from 'react';
import type { RuntimePluginObject } from '@armemon-library/config-types';

function PassthroughProvider({ children }: { children: ReactNode }): ReactElement {
  return <>{children}</>;
}

export const AdvancedInitPlugin: RuntimePluginObject = {
  name: 'advanced-init',
  provider: PassthroughProvider,
  tasks: [],
};
