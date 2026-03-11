export type MailMessage = {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

export interface MailProvider {
  sendEmail(message: MailMessage): Promise<void>;
  sendBatchEmails(messages: MailMessage[]): Promise<void>;
}
