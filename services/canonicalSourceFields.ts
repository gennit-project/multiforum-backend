/** Private provenance for application-owned maps keyed by schema field names.
 * Caller-selected Neo4j response-key projections must never be marked here.
 * Fixed internal documents may opt in only after their actual alias-free object
 * selection is verified and GraphQL completion succeeds.
 */
const canonicalSources = new WeakSet<object>();
export function rememberCanonicalSource<T extends object>(source: T): T {
  canonicalSources.add(source);
  return source;
}
export function hasCanonicalSourceFields(source: unknown): boolean {
  return source !== null && typeof source === 'object' && canonicalSources.has(source);
}
