/** Application-owned JSON shape, independent of codegen's unrestricted JSON.
 * This does not claim that the public JSON scalar has a structural contract. */
export type VariantUrlsDomain = Record<string, string> | null;
type Callable<R> = Extract<NonNullable<R>, (...args: never[]) => unknown>;
export type VariantUrlsDomainResolver<R> = (...args: Parameters<Callable<R>>) => VariantUrlsDomain;
