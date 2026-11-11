/** Type established by explicit generated author-union branch selections. */
export type AuthorSourceType = 'User' | 'ModerationProfile';
const types = new WeakMap<object, AuthorSourceType | null>();
export function rememberAuthorSourceType(parent: object, type: AuthorSourceType | null): void {
  types.set(parent, type);
}
export function authorSourceType(parent: object): { found: true; value: AuthorSourceType | null } | { found: false } {
  return types.has(parent) ? { found: true, value: types.get(parent) ?? null } : { found: false };
}
