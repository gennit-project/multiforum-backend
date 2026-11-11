/** Explicit selections, not blanket Partial models. Unselected fields remain
 * outside this boundary (they may be resolved lazily by child resolvers). */
export type Selection<T> = NonNullable<T> extends ReadonlyArray<infer Item>
  ? Selection<Item>
  : NonNullable<T> extends object
    ? { [K in keyof NonNullable<T>]?: Selection<NonNullable<T>[K]> }
    : true;

/** GraphQL enum values are strings at execution time. Preserve the exact
 * generated value union without requiring the codegen enum's nominal identity.
 * Scalar arrays remain arrays, with the schema's element/nullability contract. */
type LeafOutput<T> = T extends ReadonlyArray<infer Item> ? LeafOutput<Item>[]
  : T extends string ? `${T}` : T;

export type Projection<T, S> = S extends true ? LeafOutput<T>
  : T extends null | undefined ? T
  : T extends ReadonlyArray<infer Item> ? Projection<Item, S>[]
  : { [K in keyof S]: K extends keyof T ? Projection<T[K], S[K]> : never };

type Callable<R> = Extract<NonNullable<R>, (...args: never[]) => unknown>;
type Output<R> = Awaited<ReturnType<Callable<R>>>;
/** Keep generated parent/args/context/info and selected result nullability.
 * GraphQL completes undefined as null for nullable fields; codegen's Maybe
 * only spells null, so admit undefined only when the generated result is nullable. */
export type SelectedResolver<R, S extends Selection<Output<R>>> =
  (...args: Parameters<Callable<R>>) =>
    Projection<Output<R>, S> | (null extends Output<R> ? undefined : never) |
    Promise<Projection<Output<R>, S> | (null extends Output<R> ? undefined : never)>;
