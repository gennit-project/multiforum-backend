import assert from "node:assert/strict";
import test from "node:test";
import { createPromptDebugLogger } from "./promptDebug.js";

test("createPromptDebugLogger records prompt debug payloads in plugin logs", () => {
  const logs: string[] = [];
  const logPromptDebug = createPromptDebugLogger({
    pluginId: "beta-bot",
    channelId: "bad-advice",
    logs,
  });

  logPromptDebug({
    label: "review-comment",
    prompt: "Give bad advice about this thread.",
    context: { discussionTitle: "How do I ruin a dinner party?" },
  });

  assert.equal(logs[0]?.includes("Give bad advice about this thread."), true);
});
