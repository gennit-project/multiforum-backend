import test from "node:test";
import assert from "node:assert/strict";
import { collectCommentChannelConnections } from "../rules/permission/canEditComments.js";
import { collectDiscussionChannelConnections } from "../rules/permission/canEditDiscussions.js";
import { collectEventChannelConnections } from "../rules/permission/canEditEvents.js";

test("collectCommentChannelConnections gathers channels from all sources", () => {
  const comments = [
    {
      Channel: { uniqueName: "channel-a" },
    },
    {
      DiscussionChannel: { channelUniqueName: "channel-b" },
    },
    {
      Event: {
        EventChannels: [
          { channelUniqueName: "channel-c" },
          { channelUniqueName: "channel-d" },
        ],
      },
    },
    {
      Issue: { channelUniqueName: "channel-e" },
    },
    {
      Channel: { uniqueName: "channel-a" },
      Event: { EventChannels: [{ channelUniqueName: "channel-c" }] },
    },
  ];

  const channels = collectCommentChannelConnections(comments);
  assert.deepEqual(new Set(channels), new Set([
    "channel-a",
    "channel-b",
    "channel-c",
    "channel-d",
    "channel-e",
  ]));
});

test("collectDiscussionChannelConnections gathers discussion channels", () => {
  const discussions = [
    {
      DiscussionChannels: [
        { channelUniqueName: "channel-a" },
        { channelUniqueName: "channel-b" },
      ],
    },
    {
      DiscussionChannels: [{ channelUniqueName: "channel-b" }],
    },
    {
      DiscussionChannels: [],
    },
  ];

  const channels = collectDiscussionChannelConnections(discussions);
  assert.deepEqual(new Set(channels), new Set(["channel-a", "channel-b"]));
});

test("collectEventChannelConnections gathers event channels", () => {
  const events = [
    {
      EventChannels: [{ channelUniqueName: "channel-a" }],
    },
    {
      EventChannels: [
        { channelUniqueName: "channel-b" },
        { channelUniqueName: "channel-a" },
      ],
    },
  ];

  const channels = collectEventChannelConnections(events);
  assert.deepEqual(new Set(channels), new Set(["channel-a", "channel-b"]));
});
