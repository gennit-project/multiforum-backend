import assert from "node:assert/strict";
import test from "node:test";
import {
  validateChannelFilterGroupPayload,
  validateCreateFilterGroupsPayload,
  validateUpdateFilterGroupsPayload,
} from "./filterGroupValidationMiddleware.js";

const validGroup = (overrides: Record<string, unknown> = {}) => ({
  key: "game_packs",
  displayName: "Game Packs",
  mode: "INCLUDE",
  order: 0,
  options: {
    create: [
      {
        node: {
          value: "vampires",
          displayName: "Vampires",
          order: 0,
        },
      },
    ],
  },
  ...overrides,
});

test("accepts valid filter groups nested in a channel update", () => {
  assert.doesNotThrow(() =>
    validateChannelFilterGroupPayload({
      update: {
        FilterGroups: [
          {
            create: [
              {
                node: validGroup(),
              },
            ],
          },
        ],
      },
    })
  );
});

test("rejects invalid filter groups nested in a channel create", () => {
  assert.throws(
    () =>
      validateChannelFilterGroupPayload({
        input: [
          {
            uniqueName: "sims4_builds",
            FilterGroups: [
              {
                create: [
                  {
                    node: validGroup({ key: "bad key" }),
                  },
                ],
              },
            ],
          },
        ],
      }),
    /key can only contain/
  );
});

test("rejects duplicate filter group keys in a generated create payload", () => {
  assert.throws(
    () =>
      validateCreateFilterGroupsPayload({
        input: [
          validGroup({ key: "game_packs" }),
          validGroup({ key: "GAME_PACKS", order: 1 }),
        ],
      }),
    /Duplicate filter group key/
  );
});

test("rejects invalid filter group keys", () => {
  assert.throws(
    () =>
      validateCreateFilterGroupsPayload({
        input: [validGroup({ key: "game packs" })],
      }),
    /key can only contain/
  );
});

test("rejects invalid filter group modes", () => {
  assert.throws(
    () =>
      validateCreateFilterGroupsPayload({
        input: [validGroup({ mode: "MAYBE" })],
      }),
    /mode must be INCLUDE or EXCLUDE/
  );
});

test("rejects new filter groups without options", () => {
  assert.throws(
    () =>
      validateCreateFilterGroupsPayload({
        input: [validGroup({ options: undefined })],
      }),
    /must include at least one option/
  );
});

test("rejects duplicate option values in a group payload", () => {
  assert.throws(
    () =>
      validateCreateFilterGroupsPayload({
        input: [
          validGroup({
            options: {
              create: [
                { node: { value: "vampires", displayName: "Vampires", order: 0 } },
                { node: { value: "VAMPIRES", displayName: "Vampires Duplicate", order: 1 } },
              ],
            },
          }),
        ],
      }),
    /duplicate option value/
  );
});

test("validates nested option updates in a filter group update", () => {
  assert.throws(
    () =>
      validateUpdateFilterGroupsPayload({
        update: {
          options: [
            {
              update: {
                node: {
                  value: "",
                  displayName: "Empty Value",
                },
              },
            },
          ],
        },
      }),
    /options\[0\]\.value is required/
  );
});

test("validates nested option creates in a filter group update", () => {
  assert.throws(
    () =>
      validateUpdateFilterGroupsPayload({
        update: {
          options: [
            {
              create: [
                {
                  node: {
                    value: "vampires",
                    displayName: "",
                  },
                },
              ],
            },
          ],
        },
      }),
    /options\[0\]\.displayName is required/
  );
});

test("allows partial filter group updates when provided fields are valid", () => {
  assert.doesNotThrow(() =>
    validateUpdateFilterGroupsPayload({
      update: {
        displayName: "Required Packs",
        mode: "EXCLUDE",
      },
    })
  );
});
