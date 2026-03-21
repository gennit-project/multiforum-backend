import { Resend } from "resend";
import type { MailMessage, MailProvider } from "./types.js";

type ResendResponse = {
  data?: unknown;
  error?: {
    message?: string;
    name?: string;
  } | null;
};

export interface ResendMailClient {
  emails: {
    send(message: unknown): Promise<ResendResponse>;
  };
  batch: {
    send(messages: unknown[]): Promise<ResendResponse>;
  };
}

type CreateResendMailProviderInput = {
  apiKey: string;
  client?: ResendMailClient;
};

const throwIfResendFailed = (result: ResendResponse) => {
  if (result.error) {
    throw new Error(result.error.message || "Resend request failed");
  }
};

const mapMessageToResendPayload = (message: MailMessage) => ({
  from: message.from,
  to: [message.to],
  subject: message.subject,
  text: message.text,
  html: message.html,
  replyTo: message.replyTo,
});

export const createResendMailProvider = ({
  apiKey,
  client = new Resend(apiKey),
}: CreateResendMailProviderInput): MailProvider => ({
  async sendEmail(message: MailMessage) {
    const result = await client.emails.send(mapMessageToResendPayload(message));
    throwIfResendFailed(result);
  },
  async sendBatchEmails(messages: MailMessage[]) {
    const result = await client.batch.send(
      messages.map(mapMessageToResendPayload)
    );
    throwIfResendFailed(result);
  },
});
