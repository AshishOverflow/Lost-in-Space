// ============================================================
// Environments Module Entry Point
// ============================================================

export * from './types';
export * from './generator';
export * from './maps';

import { EnvironmentProperties, GeneratedEnvironment } from './types';
import { generateEnvironment } from './generator';
import { DEFAULT_ENVIRONMENT, MAPS_REGISTRY } from './maps';

/**
 * Switch or generate any environment by passing its properties.
 * The call signature is identical for all environments:
 *   switchEnvironment(marsProperties, seed)
 *   switchEnvironment(lunarProperties, seed)
 *   switchEnvironment(europaProperties, seed)
 *   switchEnvironment(titanProperties, seed)
 *
 * @param properties The environment properties object
 * @param seed Optional seed for procedural generation
 */
export function switchEnvironment(
  properties: EnvironmentProperties = DEFAULT_ENVIRONMENT,
  seed: number = 42
): GeneratedEnvironment {
  return generateEnvironment(properties, seed);
}

/**
 * Switch environment by its unique string ID.
 *
 * @param id 'mars' | 'lunar' | 'europa' | 'titan'
 * @param seed Optional seed for procedural generation
 */
export function switchEnvironmentById(
  id: string,
  seed: number = 42
): GeneratedEnvironment {
  const target = MAPS_REGISTRY[id] || DEFAULT_ENVIRONMENT;
  return generateEnvironment(target, seed);
}
