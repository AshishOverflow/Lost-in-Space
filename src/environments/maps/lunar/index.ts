// ============================================================
// Lunar Environment Map Module
// ============================================================

import { generateEnvironment } from '../../generator';
import { lunarProperties } from './properties';

export * from './properties';

/** Generate Lunar environment with standard properties */
export function createLunarMap(seed: number = 42) {
  return generateEnvironment(lunarProperties, seed);
}
