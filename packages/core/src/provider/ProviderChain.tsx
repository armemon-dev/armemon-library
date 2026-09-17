/**
 * FILE: ProviderChain.tsx
 * PATH: packages/core/src/provider/ProviderChain.tsx
 *
 * WHAT: Composes a list of plugin providers around `children`, nesting them so that
 *       ascending `index` ends up outermost.
 * WHY:  Plugins need a predictable, index-driven nesting order (e.g. splash at
 *       index -100 must wrap literally everything, Redux before UI theming before
 *       Navigation) without every plugin author having to coordinate with every
 *       other plugin author.
 * HOW:  reduceRight over the (already index-sorted, ascending) plugin array: the
 *       last element wraps `children` first (ends up innermost), each earlier
 *       element wraps progressively outward, so the first (smallest index) element
 *       ends up outermost.
 * WHEN: Rendered once by KitProvider, after plugin registration/validation and after
 *       the init task queue has resolved.
 *
 * EXPORTS: ProviderChain
 * DEPENDS ON: @armemon-library/config-types, react
 * USED BY: packages/core/src/provider/KitProvider.tsx
 */

import React, { type ReactElement, type ReactNode } from 'react';
import type { RuntimePluginObject } from '@armemon-library/config-types';

export interface ProviderChainProps {
  plugins: RuntimePluginObject[];
  children: ReactNode;
}

export function ProviderChain({ plugins, children }: ProviderChainProps): ReactElement {
  // Seeded with a fragment rather than casting `children` to ReactElement: children
  // is legitimately a string, an array or null, none of which is an element, and the
  // cast made the empty-plugins case return something that didn't match the
  // declared return type.
  return plugins.reduceRight<ReactElement>(
    (acc, plugin) => React.createElement(plugin.provider, null, acc),
    <>{children}</>,
  );
}
