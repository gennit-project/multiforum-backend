import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import getUploadedDownloadableFiles from "./getUploadedDownloadableFiles.js";

const buildRecord = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
});

const buildDriver = () => {
  const calls = {
    params: [] as Record<string, unknown>[],
    closed: 0,
  };

  const driver = {
    session: ({ defaultAccessMode }: { defaultAccessMode: string }) => ({
      run: async (query: string, params: Record<string, unknown>) => {
        calls.params.push({ defaultAccessMode, query, ...params });
        return {
          records: [
            buildRecord({
              group: {
                discussion: {
                  id: "discussion-1",
                  title: "Printable model",
                  channelUniqueNames: ["models"],
                },
                files: [
                  {
                    id: "file-1",
                    fileName: "model.stl",
                    uploadedByUsername: "alice",
                  },
                ],
              },
            }),
          ],
        };
      },
      close: async () => {
        calls.closed += 1;
      },
    }),
  };

  return { driver: driver as unknown as Driver, calls };
};

const contextFor = (username?: string): GraphQLContext =>
  ({
    user: username ? { username } : null,
  }) as unknown as GraphQLContext;

test("getUploadedDownloadableFiles returns the caller's uploaded files grouped by discussion", async () => {
  const { driver, calls } = buildDriver();
  const resolver = getUploadedDownloadableFiles({ driver });

  const result = await resolver(null, { username: "alice" }, contextFor("alice"));

  assert.deepEqual(
    {
      result,
      username: calls.params[0].username,
      closed: calls.closed,
    },
    {
      result: [
        {
          discussion: {
            id: "discussion-1",
            title: "Printable model",
            channelUniqueNames: ["models"],
          },
          files: [
            {
              id: "file-1",
              fileName: "model.stl",
              uploadedByUsername: "alice",
            },
          ],
        },
      ],
      username: "alice",
      closed: 1,
    }
  );
});

test("getUploadedDownloadableFiles rejects another user's upload inventory", async () => {
  const { driver } = buildDriver();
  const resolver = getUploadedDownloadableFiles({ driver });

  await assert.rejects(
    resolver(null, { username: "alice" }, contextFor("mallory")),
    /Not authorized/
  );
});
