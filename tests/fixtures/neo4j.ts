// Helpers for building fake Neo4j driver results.
//
// Real neo4j-driver records are not plain objects: callers read columns with
// `record.get("columnName")`. Many resolvers also call `record.toObject()`.
// These helpers turn plain row objects into records with that shape so tests
// don't have to hand-roll `{ get: (k) => ... }` closures.

export type Row = Record<string, unknown>;

export interface FakeRecord {
  get(key: string): unknown;
  toObject(): Row;
  keys: string[];
}

export function makeRecord(row: Row): FakeRecord {
  return {
    get: (key: string) => row[key],
    toObject: () => ({ ...row }),
    keys: Object.keys(row),
  };
}

export function makeRecords(rows: Row[]): FakeRecord[] {
  return rows.map(makeRecord);
}

// Mirrors the shape returned by `session.run(...)`: `{ records: [...] }`.
export function makeResult(rows: Row[] = []): { records: FakeRecord[] } {
  return { records: makeRecords(rows) };
}
