/** Identity selected by a verified source adapter, never inferred from filters or response aliases. */
const identities = new WeakMap<object, unknown>();
export function rememberAccountChildIdentity(parent: object, identity: unknown): void {
  identities.set(parent, identity);
}
export function accountChildIdentity(parent: object): { found: true; value: unknown } | { found: false } {
  return identities.has(parent) ? { found: true, value: identities.get(parent) } : { found: false };
}
