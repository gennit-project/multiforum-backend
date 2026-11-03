// Neo4j removes null properties. Default GraphQL completion treats these two
// nullable fields as null when absent; retain that existing source shape.
type NullableKeys<T> = { [K in keyof T]-?: null extends T[K] ? K : never }[keyof T];
export type AbsentLockMetadata<T> = T extends object
 ? "lockedAt"|"lockReason" extends NullableKeys<T>
   ? Omit<T,"lockedAt"|"lockReason"> & { [K in Extract<keyof T,"lockedAt"|"lockReason">]?: T[K] }
   : never
 : T;
