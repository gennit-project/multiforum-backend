import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeAlbumCreateInput,
  sanitizeImagesFieldInput,
  sanitizeAlbumCreateNode,
  sanitizeAlbumUpdateNode,
} from "./ownershipSanitizers.js";

// The sanitizers return `unknown`; cast results to this self-referential
// indexable shape so the tests can read the nested properties they assert
// on at any depth without resorting to `any`.
interface SanitizedRecord {
  [key: string]: SanitizedRecord;
}

// sanitizeAlbumCreateInput tests
test("sanitizeAlbumCreateInput replaces client-provided Owner with server username", () => {
  const clientInput = {
    imageOrder: ["img1", "img2"],
    Owner: {
      connect: {
        where: {
          node: {
            username: "malicious-user",
          },
        },
      },
    },
  };

  const result = sanitizeAlbumCreateInput(clientInput, "actual-user") as SanitizedRecord;

  assert.deepEqual(result.Owner, {
    connect: {
      where: {
        node: {
          username: "actual-user",
        },
      },
    },
  });
});

test("sanitizeAlbumCreateInput sets Owner when client omits it", () => {
  const clientInput = {
    imageOrder: ["img1", "img2"],
  };

  const result = sanitizeAlbumCreateInput(clientInput, "logged-in-user") as SanitizedRecord;

  assert.deepEqual(result.Owner, {
    connect: {
      where: {
        node: {
          username: "logged-in-user",
        },
      },
    },
  });
});

test("sanitizeAlbumCreateInput preserves other album properties", () => {
  const clientInput = {
    imageOrder: ["img1", "img2", "img3"],
    someCustomField: "value",
  };

  const result = sanitizeAlbumCreateInput(clientInput, "user") as SanitizedRecord;

  assert.deepEqual(result.imageOrder, ["img1", "img2", "img3"]);
  assert.equal(result.someCustomField, "value");
});

test("sanitizeAlbumCreateInput sanitizes nested Images.create entries", () => {
  const clientInput = {
    imageOrder: ["img1"],
    Images: {
      create: [
        {
          node: {
            url: "https://example.com/image.jpg",
            alt: "Test image",
            Uploader: {
              connect: {
                where: {
                  node: {
                    username: "spoofed-uploader",
                  },
                },
              },
            },
          },
        },
      ],
    },
  };

  const result = sanitizeAlbumCreateInput(clientInput, "real-user") as SanitizedRecord;

  assert.deepEqual(result.Images.create[0].node.Uploader, {
    connect: {
      where: {
        node: {
          username: "real-user",
        },
      },
    },
  });
  assert.equal(result.Images.create[0].node.url, "https://example.com/image.jpg");
  assert.equal(result.Images.create[0].node.alt, "Test image");
});

test("sanitizeAlbumCreateInput handles null/undefined input", () => {
  const resultNull = sanitizeAlbumCreateInput(null, "user");
  const resultUndefined = sanitizeAlbumCreateInput(undefined, "user");

  assert.deepEqual(resultNull.Owner, {
    connect: { where: { node: { username: "user" } } },
  });
  assert.deepEqual(resultUndefined.Owner, {
    connect: { where: { node: { username: "user" } } },
  });
});

// sanitizeImagesFieldInput tests
test("sanitizeImagesFieldInput replaces Uploader in all create entries", () => {
  const imagesField = {
    create: [
      {
        node: {
          url: "https://example.com/1.jpg",
          Uploader: {
            connect: { where: { node: { username: "attacker" } } },
          },
        },
      },
      {
        node: {
          url: "https://example.com/2.jpg",
          Uploader: {
            connect: { where: { node: { username: "another-attacker" } } },
          },
        },
      },
    ],
  };

  const result = sanitizeImagesFieldInput(imagesField, "legitimate-user") as SanitizedRecord;

  assert.equal(result.create.length, 2);
  assert.deepEqual(result.create[0].node.Uploader, {
    connect: { where: { node: { username: "legitimate-user" } } },
  });
  assert.deepEqual(result.create[1].node.Uploader, {
    connect: { where: { node: { username: "legitimate-user" } } },
  });
});

test("sanitizeImagesFieldInput preserves image properties while replacing Uploader", () => {
  const imagesField = {
    create: [
      {
        node: {
          url: "https://example.com/photo.jpg",
          alt: "A photo",
          caption: "My caption",
          copyright: "CC-BY-4.0",
          Uploader: {
            connect: { where: { node: { username: "wrong" } } },
          },
        },
      },
    ],
  };

  const result = sanitizeImagesFieldInput(imagesField, "correct-user") as SanitizedRecord;

  assert.equal(result.create[0].node.url, "https://example.com/photo.jpg");
  assert.equal(result.create[0].node.alt, "A photo");
  assert.equal(result.create[0].node.caption, "My caption");
  assert.equal(result.create[0].node.copyright, "CC-BY-4.0");
});

test("sanitizeImagesFieldInput handles missing create field", () => {
  const imagesFieldNoCreate = { connect: [] };
  const result = sanitizeImagesFieldInput(imagesFieldNoCreate, "user");

  assert.deepEqual(result, imagesFieldNoCreate);
});

test("sanitizeImagesFieldInput handles null/undefined input", () => {
  const resultNull = sanitizeImagesFieldInput(null, "user");
  const resultUndefined = sanitizeImagesFieldInput(undefined, "user");

  assert.equal(resultNull, null);
  assert.equal(resultUndefined, undefined);
});

test("sanitizeImagesFieldInput handles entries without node property", () => {
  const imagesField = {
    create: [
      { someOtherStructure: "value" },
    ],
  };

  const result = sanitizeImagesFieldInput(imagesField, "user") as SanitizedRecord;

  assert.deepEqual(result.create[0], { someOtherStructure: "value" });
});

test("sanitizeImagesFieldInput handles single object create (not array)", () => {
  const imagesField = {
    create: {
      node: {
        url: "https://example.com/single.jpg",
        Uploader: {
          connect: { where: { node: { username: "spoofed" } } },
        },
      },
    },
  };

  const result = sanitizeImagesFieldInput(imagesField, "real-user") as SanitizedRecord;

  // Should be converted to array
  assert.ok(Array.isArray(result.create));
  assert.deepEqual(result.create[0].node.Uploader, {
    connect: { where: { node: { username: "real-user" } } },
  });
});

// sanitizeAlbumCreateNode tests
test("sanitizeAlbumCreateNode delegates to sanitizeAlbumCreateInput", () => {
  const node = {
    imageOrder: ["a", "b"],
    Owner: {
      connect: { where: { node: { username: "wrong" } } },
    },
  };

  const result = sanitizeAlbumCreateNode(node, "correct") as SanitizedRecord;

  assert.deepEqual(result.Owner, {
    connect: { where: { node: { username: "correct" } } },
  });
});

test("sanitizeAlbumCreateNode returns null/undefined unchanged", () => {
  assert.equal(sanitizeAlbumCreateNode(null, "user"), null);
  assert.equal(sanitizeAlbumCreateNode(undefined, "user"), undefined);
});

// sanitizeAlbumUpdateNode tests
test("sanitizeAlbumUpdateNode strips Owner from update input", () => {
  const updateNode = {
    imageOrder: ["x", "y", "z"],
    Owner: {
      connect: { where: { node: { username: "attempted-takeover" } } },
    },
  };

  const result = sanitizeAlbumUpdateNode(updateNode, "current-owner") as SanitizedRecord;

  assert.equal(result.Owner, undefined);
  assert.deepEqual(result.imageOrder, ["x", "y", "z"]);
});

test("sanitizeAlbumUpdateNode sanitizes nested Images.create in updates", () => {
  const updateNode = {
    imageOrder: ["new-img"],
    Images: {
      create: [
        {
          node: {
            url: "https://example.com/new.jpg",
            Uploader: {
              connect: { where: { node: { username: "spoofed" } } },
            },
          },
        },
      ],
    },
  };

  const result = sanitizeAlbumUpdateNode(updateNode, "real-owner") as SanitizedRecord;

  assert.deepEqual(result.Images.create[0].node.Uploader, {
    connect: { where: { node: { username: "real-owner" } } },
  });
});

test("sanitizeAlbumUpdateNode returns null/undefined unchanged", () => {
  assert.equal(sanitizeAlbumUpdateNode(null, "user"), null);
  assert.equal(sanitizeAlbumUpdateNode(undefined, "user"), undefined);
});

test("sanitizeAlbumUpdateNode preserves non-ownership fields", () => {
  const updateNode = {
    imageOrder: ["1", "2", "3"],
    customField: "preserved",
  };

  const result = sanitizeAlbumUpdateNode(updateNode, "user") as SanitizedRecord;

  assert.deepEqual(result.imageOrder, ["1", "2", "3"]);
  assert.equal(result.customField, "preserved");
});
