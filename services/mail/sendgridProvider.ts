import sgMail from "@sendgrid/mail";
import type { MailMessage, MailProvider } from "./types.js";

export interface SendGridMailClient {
  setApiKey(apiKey: string): void;
  send(message: unknown): Promise<unknown>;
}

type CreateSendGridMailProviderInput = {
  apiKey: string;
  client?: SendGridMailClient;
};

export const createSendGridMailProvider = ({
  apiKey,
  client = sgMail,
}: CreateSendGridMailProviderInput): MailProvider => {
  client.setApiKey(apiKey);

  return {
    async sendEmail(message: MailMessage) {
      await client.send(message);
    },
    async sendBatchEmails(messages: MailMessage[]) {
      await client.send(messages);
    },
  };
};
