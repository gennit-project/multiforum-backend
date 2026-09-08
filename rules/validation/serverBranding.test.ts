import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CUSTOM_FOOTER_LINKS,
  isSafeBrandingUrl,
  validateServerBrandingInput,
} from "./serverBranding.js";

test("accepts http(s) URLs and site-relative paths", () => {
  assert.equal(isSafeBrandingUrl("https://docs.example.com"), true);
  assert.equal(isSafeBrandingUrl("http://docs.example.com"), true);
  assert.equal(isSafeBrandingUrl("/handbook"), true);
});

test("rejects unsafe and protocol-relative URLs", () => {
  assert.equal(isSafeBrandingUrl("javascript:alert(1)"), false);
  assert.equal(isSafeBrandingUrl("data:text/html,<script></script>"), false);
  assert.equal(isSafeBrandingUrl("//evil.example.com"), false);
  assert.equal(isSafeBrandingUrl("not a url"), false);
});

test("accepts a valid branding update and unrelated partial updates", () => {
  assert.equal(
    validateServerBrandingInput({
      brandingProductName: "Acme Forum",
      brandingDocsURL: "https://docs.acme.test",
      brandingSupportEmail: "help@acme.test",
      brandingPrimaryColor: "#f97316",
    }),
    true
  );
  assert.equal(validateServerBrandingInput({ serverDescription: "hello" }), true);
});

test("treats empty strings as clearing a field", () => {
  assert.equal(validateServerBrandingInput({ brandingDocsURL: "" }), true);
  assert.equal(validateServerBrandingInput({ brandingSupportEmail: "" }), true);
  assert.equal(validateServerBrandingInput({ brandingPrimaryColor: "" }), true);
});

test("rejects an unsafe branding URL", () => {
  assert.match(
    String(validateServerBrandingInput({ brandingSourceURL: "javascript:alert(1)" })),
    /http\(s\) URL or a site-relative path/
  );
});

test("rejects a malformed support email", () => {
  assert.match(
    String(validateServerBrandingInput({ brandingSupportEmail: "not-an-email" })),
    /valid email address/
  );
});

test("rejects a non-hex primary color", () => {
  assert.match(
    String(validateServerBrandingInput({ brandingPrimaryColor: "orange" })),
    /hex color/
  );
});

test("accepts well-formed custom footer links as an array or JSON string", () => {
  assert.equal(
    validateServerBrandingInput({
      brandingCustomFooterLinks: [{ label: "Handbook", url: "/handbook" }],
    }),
    true
  );
  assert.equal(
    validateServerBrandingInput({
      brandingCustomFooterLinks: '[{"label":"Handbook","url":"https://acme.test"}]',
    }),
    true
  );
});

test("rejects custom footer links with an unsafe URL or missing label", () => {
  assert.match(
    String(
      validateServerBrandingInput({
        brandingCustomFooterLinks: [{ label: "Bad", url: "javascript:alert(1)" }],
      })
    ),
    /http\(s\) URL or a site-relative path/
  );
  assert.match(
    String(
      validateServerBrandingInput({
        brandingCustomFooterLinks: [{ label: "  ", url: "/handbook" }],
      })
    ),
    /non-empty label/
  );
});

test("rejects malformed JSON and oversized link lists", () => {
  assert.match(
    String(validateServerBrandingInput({ brandingCustomFooterLinks: "{not json" })),
    /valid JSON/
  );
  const tooMany = Array.from({ length: MAX_CUSTOM_FOOTER_LINKS + 1 }, (_, i) => ({
    label: `Link ${i}`,
    url: `/link-${i}`,
  }));
  assert.match(
    String(validateServerBrandingInput({ brandingCustomFooterLinks: tooMany })),
    /at most/
  );
});

test("rejects an over-long product name", () => {
  assert.match(
    String(validateServerBrandingInput({ brandingProductName: "x".repeat(200) })),
    /characters or fewer/
  );
});
