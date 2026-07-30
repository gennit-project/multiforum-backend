import type { ModelMap } from "../../ogm_types.js";

export type ModelStubMethods<K extends keyof ModelMap> = {
  find?: (
    ...args: Parameters<ModelMap[K]["find"]>
  ) => Promise<readonly unknown[]>;
  create?: (
    ...args: Parameters<ModelMap[K]["create"]>
  ) => Promise<unknown>;
  update?: (
    ...args: Parameters<ModelMap[K]["update"]>
  ) => Promise<unknown>;
  delete?: (
    ...args: Parameters<ModelMap[K]["delete"]>
  ) => Promise<unknown>;
  aggregate?: (
    ...args: Parameters<ModelMap[K]["aggregate"]>
  ) => Promise<unknown>;
};

/**
 * OGM selection sets return partial records, while generated model methods are
 * typed as returning complete GraphQL entities. Keep that test-only assertion
 * in one place instead of weakening every resolver fixture with `any`.
 */
export const modelStub = <K extends keyof ModelMap>(
  methods: ModelStubMethods<K> = {}
): ModelMap[K] =>
  ({
    find: async () => [],
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => ({ nodesDeleted: 0, relationshipsDeleted: 0 }),
    aggregate: async () => ({}),
    ...methods,
  }) as unknown as ModelMap[K];
