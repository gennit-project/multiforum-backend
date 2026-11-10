import type { Selection } from './selection.js';

type Callable<R> = Extract<NonNullable<R>, (...args: never[]) => unknown>;
type Output<R> = Awaited<ReturnType<Callable<R>>>;
// Preserve only the selected schema properties' existing optionality, needed
// for nullable fields on generated parent types; never optionalize all fields.
type RawProperties<T, S> = { [Key in keyof T]: Key extends keyof S ? RawSelectedSource<T[Key], S[Key]> : never };
/** Explicit source selection tied to schema field names and container shape.
 * Scalar leaves are raw unknown values: GraphQL still owns selection-time scalar
 * coercion and null bubbling. This is NOT a generated response-value guarantee.
 * No unselected property is added or represented by a blanket Partial entity.
 */
export type RawSelectedSource<T, S> = S extends true ? unknown
  : T extends null | undefined ? T
  : T extends PromiseLike<infer Value> ? RawSelectedSource<Value, S>
  : T extends ReadonlyArray<infer Item> ? RawSelectedSource<Item, S>[]
  : RawProperties<Pick<T, Extract<keyof S, keyof T>>, S> & { [Key in Exclude<keyof S, keyof T>]: never };

type ListSource<T, S> = 0 extends (1 & T) ? never
  : T extends null | undefined ? T
  : T extends readonly unknown[] ? RawSelectedSource<T, S> : never;
export type RawSelectedListResolver<R, S extends Selection<Output<R>>> =
  (...args: Parameters<Callable<R>>) => ListSource<Output<R>, S>;
