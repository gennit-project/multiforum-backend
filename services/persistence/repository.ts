/**
 * The persistence surface used while the discontinued Neo4j GraphQL OGM is
 * removed incrementally. Domain code should depend on these repositories, not
 * on the concrete OGM or its `model()` lookup API.
 *
 * Keeping the model's generated method signatures means migrations retain
 * their current input and result types. A future driver-backed repository can
 * implement the same contract one domain at a time.
 */
export type CrudModel = {
  find: (...args: any[]) => Promise<any>;
  create: (...args: any[]) => Promise<any>;
  update: (...args: any[]) => Promise<any>;
  delete: (...args: any[]) => Promise<any>;
};

export type Repository<Model extends CrudModel> = Pick<
  Model,
  "find" | "create" | "update" | "delete"
>;

export type ModelProvider<ModelMap> = {
  model<Name extends keyof ModelMap>(name: Name): ModelMap[Name];
};

export type RepositoryProvider<
  ModelMap extends { [Name in keyof ModelMap]: CrudModel },
> = {
  repository<Name extends keyof ModelMap>(
    name: Name
  ): Repository<ModelMap[Name]>;
};

/**
 * Adapt an OGM-style model provider to the application-owned repository
 * boundary. Methods are bound deliberately: OGM models use instance state and
 * lose it if callers retain an unbound method reference.
 */
export function createRepositoryProvider<
  ModelMap extends { [Name in keyof ModelMap]: CrudModel },
>(models: ModelProvider<ModelMap>): RepositoryProvider<ModelMap> {
  return {
    repository<Name extends keyof ModelMap>(
      name: Name
    ): Repository<ModelMap[Name]> {
      const model = models.model(name);
      return {
        find: model.find.bind(model),
        create: model.create.bind(model),
        update: model.update.bind(model),
        delete: model.delete.bind(model),
      };
    },
  };
}
