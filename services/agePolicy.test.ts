import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AGE_POLICY,
  calculateAge,
  getAgeEligibility,
  loadAgePolicy,
  normalizeAgePolicy,
  parseBirthday,
  validateRegistrationBirthday,
} from "./agePolicy.js";

const NOW = new Date("2026-09-07T12:00:00.000Z");

test("parseBirthday accepts only real ISO calendar dates", () => {
  assert.equal(parseBirthday("2000-02-29")?.toISOString(), "2000-02-29T00:00:00.000Z");
  assert.equal(parseBirthday("2001-02-29"), null);
  assert.equal(parseBirthday("09/07/2000"), null);
});

test("calculateAge handles the day before and on the birthday", () => {
  assert.equal(calculateAge("2008-09-08", NOW), 17);
  assert.equal(calculateAge("2008-09-07", NOW), 18);
});

test("registration requires a birthday when either gate is enabled", () => {
  assert.throws(
    () =>
      validateRegistrationBirthday({
        birthday: null,
        policy: { ...DEFAULT_AGE_POLICY, sensitiveContentAgeGateEnabled: true },
        now: NOW,
      }),
    /BIRTHDAY_REQUIRED/
  );
});

test("registration rejects users below the configured account age", () => {
  assert.throws(
    () =>
      validateRegistrationBirthday({
        birthday: "2013-09-08",
        policy: { ...DEFAULT_AGE_POLICY, accountAgeGateEnabled: true },
        now: NOW,
      }),
    /MINIMUM_AGE_NOT_MET/
  );
});

test("registration accepts the exact configured account-age boundary", () => {
  assert.doesNotThrow(() =>
    validateRegistrationBirthday({
      birthday: "2013-09-07",
      policy: { ...DEFAULT_AGE_POLICY, accountAgeGateEnabled: true },
      now: NOW,
    })
  );
});

test("missing birthday remains ineligible for sensitive content", () => {
  assert.deepEqual(
    getAgeEligibility({
      birthday: null,
      policy: { ...DEFAULT_AGE_POLICY, sensitiveContentAgeGateEnabled: true },
      now: NOW,
    }),
    { meetsAccountMinimumAge: null, mayAccessSensitiveContent: false }
  );
});

test("disabled sensitive-content gate does not require age eligibility", () => {
  assert.equal(
    getAgeEligibility({ birthday: null, policy: DEFAULT_AGE_POLICY, now: NOW })
      .mayAccessSensitiveContent,
    true
  );
});

test("normalizes absent legacy server fields to safe deployment defaults", () => {
  assert.deepEqual(normalizeAgePolicy({}), DEFAULT_AGE_POLICY);
});

test("loads the named server policy", async () => {
  let receivedName = "";
  const policy = await loadAgePolicy(
    {
      find: async ({ where }) => {
        receivedName = where.serverName;
        return [{ accountAgeGateEnabled: true, minimumAccountAge: 16 }];
      },
    },
    "Example Server"
  );

  assert.equal(receivedName, "Example Server");
  assert.equal(policy.accountAgeGateEnabled, true);
  assert.equal(policy.minimumAccountAge, 16);
  assert.equal(policy.minimumSensitiveContentAge, 18);
});
