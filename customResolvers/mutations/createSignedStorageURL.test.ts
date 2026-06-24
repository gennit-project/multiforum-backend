import assert from "node:assert/strict";
import test from "node:test";
import { validateFile } from "./createSignedStorageURL.js";
import { ModelStub } from "../../tests/testUtils.js";

const createContext = ({
  channel,
  serverConfig = { allowedFileTypes: [] },
}: {
  channel: Record<string, unknown> | null;
  serverConfig?: Record<string, unknown>;
}) => ({
  ogm: {
    model: (name: string) => {
      if (name === "Channel") {
        return new ModelStub(() => (channel ? [channel] : []));
      }

      if (name === "ServerConfig") {
        return new ModelStub(() => [serverConfig]);
      }

      throw new Error(`Unexpected model lookup: ${name}`);
    },
  },
}) as unknown as Parameters<typeof validateFile>[3];

test("image upload validation rejects disabled image upload channels", async () => {
  await assert.rejects(
    validateFile(
      "photo.jpg",
      "image/jpeg",
      ["cats"],
      createContext({
        channel: { uniqueName: "cats", imageUploadsEnabled: false },
      })
    ),
    /Image uploads are disabled in channel 'cats'/
  );
});

test("image upload validation ignores download file type restrictions", async () => {
  const result = await validateFile(
    "photo.jpg",
    "image/jpeg",
    ["cats"],
    createContext({
      channel: {
        uniqueName: "cats",
        imageUploadsEnabled: true,
        allowedFileTypes: ["stl"],
      },
    })
  );

  assert.equal(result, undefined);
});

test("download upload validation rejects disallowed channel file types", async () => {
  await assert.rejects(
    validateFile(
      "archive.zip",
      "application/zip",
      ["cats"],
      createContext({
        channel: {
          uniqueName: "cats",
          imageUploadsEnabled: true,
          allowedFileTypes: ["stl"],
        },
      })
    ),
    /File type 'zip' is not allowed in channel 'cats'/
  );
});
