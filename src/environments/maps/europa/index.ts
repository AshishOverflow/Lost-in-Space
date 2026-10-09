// ============================================================
// Europa Environment Map Module
// ============================================================

import { generateEnvironment } from '../../generator';
import { europaProperties } from './properties';

export * from './properties';

/** Generate Europa environment with standard properties */
export function createEuropaMap(seed: number = 42) {
  return generateEnvironment(europaProperties, seed);
}
