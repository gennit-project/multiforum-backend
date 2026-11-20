import assert from "node:assert/strict";
import test from "node:test";
import { slugify, buildSlugSegment, parseSlugSegmentNumber } from "./slugify.js";

test("slugify lowercases and hyphenates", () => {
  assert.equal(slugify("Trail Conditions"), "trail-conditions");
});

test("slugify collapses punctuation and whitespace runs", () => {
  assert.equal(slugify("  Hello,   World!!  "), "hello-world");
  assert.equal(slugify("a/b\\c:d"), "a-b-c-d");
});

test("slugify strips diacritics", () => {
  assert.equal(slugify("Crème brûlée café"), "creme-brulee-cafe");
});

test("slugify returns empty string for empty/untitled input", () => {
  assert.equal(slugify(""), "");
  assert.equal(slugify(null), "");
  assert.equal(slugify(undefined), "");
  assert.equal(slugify("!!!"), "");
});

test("slugify caps length without a trailing hyphen", () => {
  const long = "word ".repeat(40); // 200 chars of "word word word..."
  const result = slugify(long, 20);
  assert.ok(result.length <= 20);
  assert.ok(!result.endsWith("-"));
  assert.match(result, /^word(-word)*$/);
});

test("buildSlugSegment combines number and slug", () => {
  assert.equal(buildSlugSegment(42, "Trail Conditions"), "42-trail-conditions");
  assert.equal(buildSlugSegment(7, "Saturday Cleanup"), "7-saturday-cleanup");
});

test("buildSlugSegment falls back to the number alone when untitled", () => {
  assert.equal(buildSlugSegment(42, ""), "42");
  assert.equal(buildSlugSegment(42, null), "42");
  assert.equal(buildSlugSegment(42, "!!!"), "42");
});

test("parseSlugSegmentNumber reads the leading integer and ignores the slug", () => {
  assert.equal(parseSlugSegmentNumber("42-trail-conditions"), 42);
  assert.equal(parseSlugSegmentNumber("7"), 7);
  assert.equal(parseSlugSegmentNumber("  13-foo "), 13);
});

test("parseSlugSegmentNumber returns null for non-numeric segments", () => {
  assert.equal(parseSlugSegmentNumber("trail-conditions"), null);
  assert.equal(parseSlugSegmentNumber(""), null);
  assert.equal(parseSlugSegmentNumber(null), null);
  assert.equal(parseSlugSegmentNumber("-5"), null);
});
