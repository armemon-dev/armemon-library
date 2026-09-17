/**
 * FILE: useKitReady.ts
 * PATH: packages/core/src/hooks/useKitReady.ts
 *
 * WHAT: Reads kit readiness state and the notifyReady() escape hatch.
 * WHY:  Gives app code a one-line way to both check "has init finished" and, when
 *       `readyCustom` is enabled, signal "actually ready now" on its own terms.
 * HOW:  Thin useContext(KitReadyContext) wrapper.
 * WHEN: Called from within app code that opted into readyCustom-based manual
 *       readiness control.
 *
 * EXPORTS: useKitReady
 * DEPENDS ON: react, ../context/KitReadyContext
 * USED BY: app code using the readyCustom config flag
 */

import { useContext } from 'react';
import { KitReadyContext, type KitReadyState } from '../context/KitReadyContext.js';

export function useKitReady(): KitReadyState {
  return useContext(KitReadyContext);
}
