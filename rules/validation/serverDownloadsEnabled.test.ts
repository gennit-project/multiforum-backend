import test from "node:test";
import assert from "node:assert/strict";
import {
  inputCreatesDownload,
  evaluateServerDownloadsEnabled,
} from "./serverDownloadsEnabled.js";
import { ERROR_MESSAGES } from "../errorMessages.js";

const downloadItem = {
  discussionCreateInput: { hasDownload: true },
  channelConnections: ["cats"],
};
const plainItem = {
  discussionCreateInput: { hasDownload: false },
  channelConnections: ["cats"],
};

test("inputCreatesDownload detects a download in the input", () => {
  assert.equal(inputCreatesDownload([downloadItem]), true);
  assert.equal(inputCreatesDownload([plainItem, downloadItem]), true);
});

test("inputCreatesDownload is false for non-download / empty / nullish input", () => {
  assert.equal(inputCreatesDownload([plainItem]), false);
  assert.equal(
    inputCreatesDownload([{ discussionCreateInput: {}, channelConnections: [] }]),
    false
  );
  assert.equal(inputCreatesDownload([]), false);
  assert.equal(inputCreatesDownload(null), false);
  assert.equal(inputCreatesDownload(undefined), false);
});

test("a non-download create is always allowed, regardless of the flag", () => {
  assert.equal(
    evaluateServerDownloadsEnabled({ input: [plainItem], enableDownloads: false }),
    true
  );
  assert.equal(
    evaluateServerDownloadsEnabled({ input: [plainItem], enableDownloads: null }),
    true
  );
});

test("a download create is allowed only when enableDownloads is exactly true", () => {
  assert.equal(
    evaluateServerDownloadsEnabled({ input: [downloadItem], enableDownloads: true }),
    true
  );
});

test("a download create is blocked when downloads are off (false / null / undefined)", () => {
  for (const enableDownloads of [false, null, undefined]) {
    assert.equal(
      evaluateServerDownloadsEnabled({ input: [downloadItem], enableDownloads }),
      ERROR_MESSAGES.download.notEnabled,
      `expected block for enableDownloads=${String(enableDownloads)}`
    );
  }
});
