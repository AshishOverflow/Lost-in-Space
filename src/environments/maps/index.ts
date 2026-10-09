// ============================================================
// Maps Directory Index — Unified Maps Registry & Switcher
// ============================================================

import { EnvironmentProperties, GeneratedEnvironment } from '../types';
import { generateEnvironment } from '../generator';

// Export individual environment modules
export * from './mars';
export * from './lunar';
export * from './europa';
export * from './titan';

import { marsProperties } from './mars/properties';
import { lunarProperties } from './lunar/properties';
import { europaProperties } from './europa/properties';
import { titanProperties } from './titan/properties';

/** Registry of all available environments keyed by id */
export const MAPS_REGISTRY: Record<string, EnvironmentProperties> = {
  mars: marsProperties,
  lunar: lunarProperties,
  europa: europaProperties,
  titan: titanProperties,
};

/** List of all environment properties for UI menus and selection */
export const AVAILABLE_MAPS: EnvironmentProperties[] = [
  marsProperties,
  lunarProperties,
  europaProperties,
  titanProperties,
];

/** Default starting environment */
export const DEFAULT_ENVIRONMENT: EnvironmentProperties = marsProperties;

/**
 * Standardized function to build any map from its environment properties.
 * Calling this function with properties of any environment produces
 * that environment with the exact same call signature.
 *
 * @param properties The environment properties object
 * @param seed Optional random generation seed
 */
export function createMap(
  properties: EnvironmentProperties,
  seed: number = 42
): GeneratedEnvironment {
  return generateEnvironment(properties, seed);
}

/**
 * Look up an environment by ID and generate it.
 *
 * @param id 'mars' | 'lunar' | 'europa' | 'titan'
 * @param seed Optional random generation seed
 */
export function createMapById(
  id: string,
  seed: number = 42
): GeneratedEnvironment {
  const envProps = MAPS_REGISTRY[id] || DEFAULT_ENVIRONMENT;
  return createMap(envProps, seed);
}
