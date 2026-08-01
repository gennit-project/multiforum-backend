import assert from "node:assert/strict";
import test from "node:test";
import {
  validateDiscussionFlairSelections,
  type ChannelDiscussionFlairRequirements,
} from "./discussionFlairSubmission.js";

const requirements = (
  entries: Array<[string, boolean, string[]]>
): Map<string, ChannelDiscussionFlairRequirements> =>
  new Map(
    entries.map(([channelUniqueName, flairRequired, activeFlairIds]) => [
      channelUniqueName,
      {
        channelUniqueName,
        flairRequired,
        activeFlairIds: new Set(activeFlairIds),
      },
    ])
  );

test("returns channel-specific active flair assignments", () => {
  const result = validateDiscussionFlairSelections({
    channelConnections: ["cats", "dogs", "birds"],
    channelFlairSelections: [
      { channelUniqueName: "cats", flairIds: ["question", "help"] },
      { channelUniqueName: "dogs", flairIds: ["showcase"] },
    ],
    requirementsByChannel: requirements([
      ["cats", true, ["question", "help"]],
      ["dogs", false, ["showcase"]],
      ["birds", false, []],
    ]),
  });

  assert.deepEqual([...result], [
    ["cats", ["question", "help"]],
    ["dogs", ["showcase"]],
    ["birds", []],
  ]);
});

test("rejects a required channel without a selection", () => {
  assert.throws(
    () =>
      validateDiscussionFlairSelections({
        channelConnections: ["cats"],
        requirementsByChannel: requirements([["cats", true, ["question"]]]),
      }),
    /At least one flair is required for channel 'cats'/
  );
});

test("rejects missing channels and inactive or cross-channel flairs", () => {
  assert.throws(
    () =>
      validateDiscussionFlairSelections({
        channelConnections: ["missing"],
        requirementsByChannel: requirements([]),
      }),
    /Channel 'missing' was not found/
  );

  assert.throws(
    () =>
      validateDiscussionFlairSelections({
        channelConnections: ["cats"],
        channelFlairSelections: [
          { channelUniqueName: "cats", flairIds: ["archived-or-foreign"] },
        ],
        requirementsByChannel: requirements([["cats", false, ["question"]]]),
      }),
    /is not active in channel 'cats'/
  );
});

test("rejects selections for an unconnected channel", () => {
  assert.throws(
    () =>
      validateDiscussionFlairSelections({
        channelConnections: ["cats"],
        channelFlairSelections: [
          { channelUniqueName: "dogs", flairIds: ["question"] },
        ],
        requirementsByChannel: requirements([["cats", false, []]]),
      }),
    /must belong to one of the discussion's selected channels/
  );
});

test("rejects duplicate channels, selection blocks, and flair IDs", () => {
  const configs = requirements([["cats", false, ["question"]]]);

  assert.throws(
    () =>
      validateDiscussionFlairSelections({
        channelConnections: ["cats", "cats"],
        requirementsByChannel: configs,
      }),
    /selected more than once/
  );
  assert.throws(
    () =>
      validateDiscussionFlairSelections({
        channelConnections: ["cats"],
        channelFlairSelections: [
          { channelUniqueName: "cats", flairIds: [] },
          { channelUniqueName: "cats", flairIds: [] },
        ],
        requirementsByChannel: configs,
      }),
    /submitted more than once/
  );
  assert.throws(
    () =>
      validateDiscussionFlairSelections({
        channelConnections: ["cats"],
        channelFlairSelections: [
          { channelUniqueName: "cats", flairIds: ["question", "question"] },
        ],
        requirementsByChannel: configs,
      }),
    /must be non-empty and unique/
  );
});
