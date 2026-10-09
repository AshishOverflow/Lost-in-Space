// ============================================================
// Mars Environment Map Module
// ============================================================

import { generateEnvironment } from '../../generator';
import { marsProperties } from './properties';

export * from './properties';

/** Generate Mars environment with standard properties */
export function createMarsMap(seed: number = 42) {
  return generateEnvironment(marsProperties, seed);
}
