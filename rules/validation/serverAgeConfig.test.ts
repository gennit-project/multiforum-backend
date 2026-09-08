import test from "node:test";
import assert from "node:assert/strict";
import { validateServerAgeConfigInput } from "./serverAgeConfig.js";

test("accepts valid age-policy fields and unrelated partial updates", () => {
  assert.equal(validateServerAgeConfigInput({ minimumAccountAge: 13 }), true);
  assert.equal(validateServerAgeConfigInput({ minimumSensitiveContentAge: 18 }), true);
  assert.equal(validateServerAgeConfigInput({ serverDescription: "hello" }), true);
});

test("rejects non-integer and out-of-range minimum ages", () => {
  assert.match(String(validateServerAgeConfigInput({ minimumAccountAge: 0 })), /between 1 and 120/);
  assert.match(String(validateServerAgeConfigInput({ minimumAccountAge: 13.5 })), /whole number/);
  assert.match(String(validateServerAgeConfigInput({ minimumSensitiveContentAge: 121 })), /between 1 and 120/);
  assert.match(String(validateServerAgeConfigInput({ minimumSensitiveContentAge: "18" })), /whole number/);
});
