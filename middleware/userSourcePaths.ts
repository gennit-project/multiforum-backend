import type { CheckedUserPaths } from './userSourcePaths.types.js';

/** Identity function: compile-check explicit paths against generated schema types.
 * It neither validates projected data nor grants permission to traverse a field.
 */
export function userSourcePaths<Root>() {
  return <const Paths extends readonly (readonly string[])[]>(paths: Paths & CheckedUserPaths<Root, Paths>): Paths => paths;
}
