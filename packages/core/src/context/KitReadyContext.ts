/**
 * FILE: KitReadyContext.ts
 * PATH: packages/core/src/context/KitReadyContext.ts
 *
 * WHAT: React context exposing kit readiness state and a notifyReady() escape hatch
 *       for apps that want to hold the splash screen open past task completion (e.g.
 *       waiting on a custom auth check) via the `readyCustom` config flag.
 * WHY:  Some apps need "ready" to mean more than "all init tasks finished" — e.g. an
 *       app might want the splash to stay up until a first API call resolves.
 *       Exposing notifyReady() lets app code opt into that without KitProvider
 *       needing to know what "actually ready" means for every app.
 * HOW:  Plain React.createContext with a no-op default notifyReady.
 * WHEN: Provided by KitProvider once tasks finish (when readyCustom is set, the
 *       provider chain still waits for notifyReady() before rendering children).
 *
 * EXPORTS: KitReadyContext, KitReadyState
 * DEPENDS ON: react
 * USED BY: packages/core/src/provider/KitProvider.tsx, packages/core/src/hooks/useKitReady.ts
 */

import { createContext } from 'react';

export interface KitReadyState {
  isKitReady: boolean;
  notifyReady: () => void;
}

export const KitReadyContext = createContext<KitReadyState>({
  isKitReady: false,
  notifyReady: () => {},
});
