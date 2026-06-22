// Factory for a fake Neo4j GraphQL OGM.
//
// Resolvers call `ogm.model("User").find(...)` / `.create(...)` / `.update(...)`
// / `.delete(...)`. Tests supply only the model methods they exercise; any
// method left unspecified resolves to a safe async no-op so unrelated calls
// don't crash. `calls.models` records every model lookup, and an unexpected
// model name throws to catch wiring mistakes.

export interface ModelStub {
  find?: (...args: any[]) => Promise<any>;
  create?: (...args: any[]) => Promise<any>;
  update?: (...args: any[]) => Promise<any>;
  delete?: (...args: any[]) => Promise<any>;
  aggregate?: (...args: any[]) => Promise<any>;
}

export interface OgmCalls {
  models: string[];
}

export function makeOgm(models: Record<string, ModelStub> = {}): {
  ogm: { model: (name: string) => Required<ModelStub> };
  calls: OgmCalls;
} {
  const calls: OgmCalls = { models: [] };

  const ogm = {
    model(name: string): Required<ModelStub> {
      calls.models.push(name);
      const stub = models[name];
      if (!stub) {
        throw new Error(`Unexpected model lookup: ${name}`);
      }
      return {
        find: stub.find ?? (async () => []),
        create: stub.create ?? (async () => ({})),
        update: stub.update ?? (async () => ({})),
        delete: stub.delete ?? (async () => ({})),
        aggregate: stub.aggregate ?? (async () => ({})),
      };
    },
  };

  return { ogm, calls };
}
