import test from "node:test";
import assert from "node:assert/strict";
import {
  getDefaultFromEmail,
  getMailProviderName,
  sendBatchEmails,
  sendEmail,
} from "./index.js";

const ORIGINAL_ENV = { ...process.env };

const resetEnv = () => {
  for (const key of [
    "EMAIL_PROVIDER",
    "EMAIL_FROM",
    "SENDGRID_FROM_EMAIL",
    "SENDGRID_API_KEY",
  ]) {
    if (Object.prototype.hasOwnProperty.call(ORIGINAL_ENV, key)) {
      process.env[key] = ORIGINAL_ENV[key];
    } else {
      delete process.env[key];
    }
  }
};

test.beforeEach(() => {
  resetEnv();
});

test.after(() => {
  for (const key of [
    "EMAIL_PROVIDER",
    "EMAIL_FROM",
    "SENDGRID_FROM_EMAIL",
    "SENDGRID_API_KEY",
  ]) {
    if (Object.prototype.hasOwnProperty.call(ORIGINAL_ENV, key)) {
      process.env[key] = ORIGINAL_ENV[key];
    } else {
      delete process.env[key];
    }
  }
});

test("getMailProviderName falls back to sendgrid", () => {
  assert.equal(getMailProviderName(), "sendgrid");
});

test("getDefaultFromEmail prefers EMAIL_FROM over SENDGRID_FROM_EMAIL", () => {
  process.env.EMAIL_FROM = "neutral@example.com";
  process.env.SENDGRID_FROM_EMAIL = "legacy@example.com";

  assert.equal(getDefaultFromEmail(), "neutral@example.com");
});

test("sendEmail sends through configured provider", async () => {
  process.env.SENDGRID_API_KEY = "test-key";
  process.env.EMAIL_FROM = "from@example.com";

  const sentMessages: any[] = [];
  let configuredApiKey: string | null = null;

  const result = await sendEmail(
    {
      to: "to@example.com",
      subject: "Subject",
      text: "Plain text",
      html: "<p>Plain text</p>",
      replyTo: "reply@example.com",
    },
    {
      dependencies: {
        sendGridClient: {
          setApiKey(apiKey: string) {
            configuredApiKey = apiKey;
          },
          async send(message) {
            sentMessages.push(message);
            return {};
          },
        },
      },
    }
  );

  assert.equal(result, true);
  assert.equal(configuredApiKey, "test-key");
  assert.deepEqual(sentMessages, [
    {
      to: "to@example.com",
      from: "from@example.com",
      subject: "Subject",
      text: "Plain text",
      html: "<p>Plain text</p>",
      replyTo: "reply@example.com",
    },
  ]);
});

test("sendEmail returns false when provider is not configured", async () => {
  const result = await sendEmail({
    to: "to@example.com",
    subject: "Subject",
    text: "Plain text",
    html: "<p>Plain text</p>",
  });

  assert.equal(result, false);
});

test("sendEmail throws when sender is required but missing", async () => {
  process.env.SENDGRID_API_KEY = "test-key";

  await assert.rejects(() =>
    sendEmail(
      {
        to: "to@example.com",
        subject: "Subject",
        text: "Plain text",
        html: "<p>Plain text</p>",
      },
      {
        throwOnError: true,
        throwOnMissingFrom: true,
        dependencies: {
          sendGridClient: {
            setApiKey() {},
            async send() {
              return {};
            },
          },
        },
      }
    )
  );
});

test("sendBatchEmails sends all messages through configured provider", async () => {
  process.env.SENDGRID_API_KEY = "test-key";
  process.env.SENDGRID_FROM_EMAIL = "legacy@example.com";

  const sentBatches: any[] = [];

  const result = await sendBatchEmails(
    [
      {
        to: "one@example.com",
        subject: "First",
        text: "Body one",
        html: "<p>Body one</p>",
      },
      {
        to: "two@example.com",
        subject: "Second",
        text: "Body two",
        html: "<p>Body two</p>",
      },
    ],
    {
      dependencies: {
        sendGridClient: {
          setApiKey() {},
          async send(message) {
            sentBatches.push(message);
            return {};
          },
        },
      },
    }
  );

  assert.equal(result, true);
  assert.deepEqual(sentBatches, [
    [
      {
        to: "one@example.com",
        from: "legacy@example.com",
        subject: "First",
        text: "Body one",
        html: "<p>Body one</p>",
      },
      {
        to: "two@example.com",
        from: "legacy@example.com",
        subject: "Second",
        text: "Body two",
        html: "<p>Body two</p>",
      },
    ],
  ]);
});

test("sendBatchEmails returns false when sender is missing", async () => {
  process.env.SENDGRID_API_KEY = "test-key";

  const result = await sendBatchEmails(
    [
      {
        to: "one@example.com",
        subject: "First",
        text: "Body one",
        html: "<p>Body one</p>",
      },
    ],
    {
      dependencies: {
        sendGridClient: {
          setApiKey() {},
          async send() {
            return {};
          },
        },
      },
    }
  );

  assert.equal(result, false);
});
