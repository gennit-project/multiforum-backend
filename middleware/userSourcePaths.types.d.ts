/** Validate only declared schema paths, never the values returned by a resolver.
 * Lists and nullable edges retain their runtime behavior. Unknown/JSON paths
 * cannot certify a User source; author unions have a separate discriminator.
 */
type IsUserPath<T, Path extends readonly string[]> = 0 extends (1 & T) ? false
  : [NonNullable<T>] extends [never] ? false
  : NonNullable<T> extends PromiseLike<infer Value> ? IsUserPath<Value, Path>
  : NonNullable<T> extends readonly (infer Item)[] ? IsUserPath<Item, Path>
  : Path extends readonly [] ? '__typename' extends keyof NonNullable<T>
    ? [Exclude<NonNullable<T>['__typename'], undefined>] extends [never] ? false
      : Exclude<NonNullable<T>['__typename'], undefined> extends 'User' ? true : false
    : false
  : Path extends readonly [infer Key extends string, ...infer Rest extends readonly string[]]
    ? Key extends keyof NonNullable<T> ? IsUserPath<NonNullable<T>[Key], Rest> : false
    : false;
export type CheckedUserPaths<Root, Paths extends readonly (readonly string[])[]> = {
  [Index in keyof Paths]: IsUserPath<Root, Paths[Index]> extends true ? Paths[Index] : never;
};
