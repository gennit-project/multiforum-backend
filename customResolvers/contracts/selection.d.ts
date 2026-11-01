/** Explicit selections, not blanket Partial models. Unselected fields remain
 * outside this boundary (they may be resolved lazily by child resolvers). */
export type Selection<T> = NonNullable<T> extends ReadonlyArray<infer Item>
  ? Selection<Item>
  : { [K in keyof NonNullable<T>]?: NonNullable<NonNullable<T>[K]> extends object
      ? Selection<NonNullable<T>[K]> : true };

export type Projection<T, S> = T extends null | undefined ? T
  : T extends ReadonlyArray<infer Item> ? Projection<Item, S>[]
  : { [K in keyof S]: K extends keyof T ? S[K] extends true ? T[K] : Projection<T[K], S[K]> : never };

type Callable<R> = Extract<NonNullable<R>, (...args: never[]) => unknown>;
type Output<R> = Awaited<ReturnType<Callable<R>>>;
/** Keep generated parent/args/context/info and selected result nullability.
 * GraphQL completes undefined as null for nullable fields; codegen's Maybe
 * only spells null, so admit undefined only when the generated result is nullable. */
export type SelectedResolver<R, S extends Selection<Output<R>>> =
  (...args: Parameters<Callable<R>>) =>
    Projection<Output<R>, S> | (null extends Output<R> ? undefined : never) |
    Promise<Projection<Output<R>, S> | (null extends Output<R> ? undefined : never)>;
