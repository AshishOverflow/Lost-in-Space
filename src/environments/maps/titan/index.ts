// ============================================================
// Titan Environment Map Module
// ============================================================

import { generateEnvironment } from '../../generator';
import { titanProperties } from './properties';

export * from './properties';

/** Generate Titan environment with standard properties */
export function createTitanMap(seed: number = 42) {
  return generateEnvironment(titanProperties, seed);
}
