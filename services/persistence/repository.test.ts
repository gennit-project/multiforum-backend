import assert from "node:assert/strict";
import test from "node:test";
import { createRepositoryProvider } from "./repository.js";

type StubModel = {
  prefix: string;
  find(args: { where: string }): Promise<string>;
  create(args: { input: string }): Promise<string>;
  update(args: { update: string }): Promise<string>;
  delete(args: { where: string }): Promise<string>;
};

const makeModel = (prefix: string): StubModel => ({
  prefix,
  async find({ where }) {
    return `${this.prefix}:find:${where}`;
  },
  async create({ input }) {
    return `${this.prefix}:create:${input}`;
  },
  async update({ update }) {
    return `${this.prefix}:update:${update}`;
  },
  async delete({ where }) {
    return `${this.prefix}:delete:${where}`;
  },
});

test("repository provider resolves the requested model lazily", async () => {
  const requested: string[] = [];
  const model = makeModel("server-config");
  const provider = createRepositoryProvider<{ ServerConfig: StubModel }>({
    model(name: "ServerConfig") {
      requested.push(name);
      return model;
    },
  });

  assert.deepEqual(requested, []);
  const repository = provider.repository("ServerConfig");
  assert.deepEqual(requested, ["ServerConfig"]);
  assert.equal(
    await repository.find({ where: "community" }),
    "server-config:find:community"
  );
});

test("repository methods preserve model binding and generated signatures", async () => {
  const model = makeModel("discussion");
  const provider = createRepositoryProvider<{ Discussion: StubModel }>({
    model(_name: "Discussion") {
      return model;
    },
  });
  const repository = provider.repository("Discussion");

  assert.deepEqual(
    await Promise.all([
      repository.find({ where: "one" }),
      repository.create({ input: "two" }),
      repository.update({ update: "three" }),
      repository.delete({ where: "four" }),
    ]),
    [
      "discussion:find:one",
      "discussion:create:two",
      "discussion:update:three",
      "discussion:delete:four",
    ]
  );
});
