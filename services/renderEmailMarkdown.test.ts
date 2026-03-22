import test from "node:test";
import assert from "node:assert/strict";
import { renderEmailMarkdownToHtml } from "./renderEmailMarkdown.js";

test("renderEmailMarkdownToHtml renders headings and blockquotes", () => {
  const html = renderEmailMarkdownToHtml("## header\n> something quoted");

  assert.match(html, /<h2>header<\/h2>/);
  assert.match(html, /<blockquote/);
  assert.match(html, /something quoted/);
});

test("renderEmailMarkdownToHtml renders emphasis, lists, and links", () => {
  const html = renderEmailMarkdownToHtml(
    "**bold**\n- item one\n- item two\n[link](https://example.com)"
  );

  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>item one<\/li>/);
  assert.match(html, /<li>item two/);
  assert.match(html, /<a href="https:\/\/example\.com">link<\/a>/);
});

test("renderEmailMarkdownToHtml escapes raw html", () => {
  const html = renderEmailMarkdownToHtml("<script>alert('xss')</script>");

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert/);
});
