import test from "node:test";
import assert from "node:assert/strict";
import { createVariantUrlsResolver } from "./variantUrls.js";

test("returns null when no stored or direct variants are available", () => {
  const resolver = createVariantUrlsResolver({
    list320: "list320Url",
    detail640: "detail640Url",
  });

  assert.equal(resolver({}), null);
});

test("returns stored variantUrls when present", () => {
  const resolver = createVariantUrlsResolver({
    list320: "list320Url",
    detail640: "detail640Url",
  });

  assert.deepEqual(
    resolver({
      variantUrls: {
        list320: "https://img.test/list-320.webp",
        detail640: "https://img.test/detail-640.webp",
      },
    }),
    {
      list320: "https://img.test/list-320.webp",
      detail640: "https://img.test/detail-640.webp",
    }
  );
});

test("merges direct fields into the normalized variant map", () => {
  const resolver = createVariantUrlsResolver({
    avatar32: "avatar32Url",
    avatar48: "avatar48Url",
  });

  assert.deepEqual(
    resolver({
      avatar32Url: "https://img.test/avatar-32.webp",
      avatar48Url: "https://img.test/avatar-48.webp",
    }),
    {
      avatar32: "https://img.test/avatar-32.webp",
      avatar48: "https://img.test/avatar-48.webp",
    }
  );
});

test("prefers explicit direct fields over stored map entries", () => {
  const resolver = createVariantUrlsResolver({
    list320: "list320Url",
    detail640: "detail640Url",
  });

  assert.deepEqual(
    resolver({
      variantUrls: {
        list320: "https://img.test/old-list-320.webp",
        detail640: "https://img.test/detail-640.webp",
      },
      list320Url: "https://img.test/new-list-320.webp",
    }),
    {
      list320: "https://img.test/new-list-320.webp",
      detail640: "https://img.test/detail-640.webp",
    }
  );
});
