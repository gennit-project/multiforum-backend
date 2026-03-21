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
    "RESEND_API_KEY",
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
    "RESEND_API_KEY",
  ]) {
    if (Object.prototype.hasOwnProperty.call(ORIGINAL_ENV, key)) {
      process.env[key] = ORIGINAL_ENV[key];
    } else {
      delete process.env[key];
    }
  }
});

test("getMailProviderName falls back to resend", () => {
  assert.equal(getMailProviderName(), "resend");
});

test("getDefaultFromEmail uses EMAIL_FROM", () => {
  process.env.EMAIL_FROM = "neutral@example.com";

  assert.equal(getDefaultFromEmail(), "neutral@example.com");
});

test("getDefaultFromEmail does not fall back to SENDGRID_FROM_EMAIL", () => {
  process.env.SENDGRID_FROM_EMAIL = "legacy@example.com";

  assert.equal(getDefaultFromEmail(), null);
});

test("getMailProviderName accepts resend", () => {
  process.env.EMAIL_PROVIDER = "resend";

  assert.equal(getMailProviderName(), "resend");
});

test("sendEmail sends through configured provider", async () => {
  process.env.EMAIL_PROVIDER = "sendgrid";
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
  process.env.EMAIL_PROVIDER = "sendgrid";
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
  process.env.EMAIL_PROVIDER = "sendgrid";
  process.env.SENDGRID_API_KEY = "test-key";
  process.env.EMAIL_FROM = "from@example.com";

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
        from: "from@example.com",
        subject: "First",
        text: "Body one",
        html: "<p>Body one</p>",
      },
      {
        to: "two@example.com",
        from: "from@example.com",
        subject: "Second",
        text: "Body two",
        html: "<p>Body two</p>",
      },
    ],
  ]);
});

test("sendBatchEmails returns false when sender is missing", async () => {
  process.env.EMAIL_PROVIDER = "sendgrid";
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

test("sendEmail routes through resend when configured", async () => {
  process.env.EMAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "resend-key";
  process.env.EMAIL_FROM = "from@example.com";

  const sentMessages: any[] = [];

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
        resendClient: {
          emails: {
            async send(message) {
              sentMessages.push(message);
              return { data: { id: "email_123" }, error: null };
            },
          },
          batch: {
            async send() {
              return { data: [], error: null };
            },
          },
        },
      },
    }
  );

  assert.equal(result, true);
  assert.deepEqual(sentMessages, [
    {
      from: "from@example.com",
      to: ["to@example.com"],
      subject: "Subject",
      text: "Plain text",
      html: "<p>Plain text</p>",
      replyTo: "reply@example.com",
    },
  ]);
});

test("sendBatchEmails routes through resend batch API", async () => {
  process.env.EMAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "resend-key";
  process.env.EMAIL_FROM = "from@example.com";

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
        resendClient: {
          emails: {
            async send() {
              return { data: { id: "unused" }, error: null };
            },
          },
          batch: {
            async send(messages) {
              sentBatches.push(messages);
              return { data: [{ id: "email_1" }], error: null };
            },
          },
        },
      },
    }
  );

  assert.equal(result, true);
  assert.deepEqual(sentBatches, [
    [
      {
        from: "from@example.com",
        to: ["one@example.com"],
        subject: "First",
        text: "Body one",
        html: "<p>Body one</p>",
        replyTo: undefined,
      },
      {
        from: "from@example.com",
        to: ["two@example.com"],
        subject: "Second",
        text: "Body two",
        html: "<p>Body two</p>",
        replyTo: undefined,
      },
    ],
  ]);
});
