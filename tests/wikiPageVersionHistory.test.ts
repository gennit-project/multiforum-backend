import test from "node:test";
import assert from "node:assert/strict";
import { wikiPageVersionHistoryHandler } from "../hooks/wikiPageVersionHistoryHook.js";

test("wiki page revision history copies the replaced version's edit reason", async () => {
  const createdTextVersions: Array<any> = [];
  const wikiPageUpdates: Array<any> = [];

  const WikiPageModel = {
    find: async () => [
      {
        id: "wiki-1",
        title: "Current title",
        body: "Current body",
        editReason: "Clarified setup steps",
        VersionAuthor: { username: "wiki-editor" },
        PastVersions: [],
      },
    ],
    update: async (input: any) => {
      wikiPageUpdates.push(input);
      return { wikiPages: [{ id: "wiki-1" }] };
    },
  };

  const TextVersionModel = {
    create: async (input: any) => {
      createdTextVersions.push(input);
      return { textVersions: [{ id: "version-1" }] };
    },
  };

  const UserModel = {
    find: async () => [{ username: "wiki-editor" }],
  };

  const context = {
    ogm: {
      model: (name: string) => {
        if (name === "WikiPage") return WikiPageModel;
        if (name === "TextVersion") return TextVersionModel;
        if (name === "User") return UserModel;
        throw new Error(`Unexpected model ${name}`);
      },
    },
  };

  await wikiPageVersionHistoryHandler({
    context,
    params: {
      where: { id: "wiki-1" },
      update: {
        body: "Updated body",
        editReason: "New edit reason",
      },
    },
  });

  assert.equal(createdTextVersions.length, 1);
  assert.deepEqual(createdTextVersions[0].input[0], {
    body: "Current body",
    editReason: "Clarified setup steps",
    Author: {
      connect: { where: { node: { username: "wiki-editor" } } },
    },
  });
  assert.equal(
    wikiPageUpdates[0].update.PastVersions.connect[0].where.node.id,
    "version-1"
  );
});
