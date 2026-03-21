import {
  createSendGridMailProvider,
  type SendGridMailClient,
} from "./sendgridProvider.js";
import {
  createResendMailProvider,
  type ResendMailClient,
} from "./resendProvider.js";
import type { MailMessage, MailProvider } from "./types.js";

type MailProviderName = "sendgrid" | "resend";

type MailServiceDependencies = {
  sendGridClient?: SendGridMailClient;
  resendClient?: ResendMailClient;
};

type SendOptions = {
  throwOnError?: boolean;
  throwOnMissingFrom?: boolean;
  dependencies?: MailServiceDependencies;
};

const SUPPORTED_PROVIDERS: MailProviderName[] = ["sendgrid", "resend"];
const DEFAULT_PROVIDER: MailProviderName = "resend";

export const getMailProviderName = (): MailProviderName => {
  const providerName = process.env.EMAIL_PROVIDER?.toLowerCase();

  if (!providerName) {
    return DEFAULT_PROVIDER;
  }

  if (SUPPORTED_PROVIDERS.includes(providerName as MailProviderName)) {
    return providerName as MailProviderName;
  }

  console.warn(
    `Unsupported EMAIL_PROVIDER "${process.env.EMAIL_PROVIDER}". Falling back to ${DEFAULT_PROVIDER}.`
  );

  return DEFAULT_PROVIDER;
};

export const getDefaultFromEmail = (): string | null =>
  process.env.EMAIL_FROM || null;

const getMailProvider = (
  dependencies?: MailServiceDependencies
): MailProvider | null => {
  const providerName = getMailProviderName();

  if (providerName === "sendgrid") {
    if (!process.env.SENDGRID_API_KEY) {
      return null;
    }

    return createSendGridMailProvider({
      apiKey: process.env.SENDGRID_API_KEY,
      client: dependencies?.sendGridClient,
    });
  }

  if (providerName === "resend") {
    if (!process.env.RESEND_API_KEY) {
      return null;
    }

    return createResendMailProvider({
      apiKey: process.env.RESEND_API_KEY,
      client: dependencies?.resendClient,
    });
  }

  return null;
};

const resolveFromEmail = (options?: SendOptions): string | null => {
  const fromEmail = getDefaultFromEmail();

  if (fromEmail) {
    return fromEmail;
  }

  if (options?.throwOnMissingFrom) {
    throw new Error("EMAIL_FROM is not set");
  }

  console.warn("EMAIL_FROM is not set. Email will not be sent.");
  return null;
};

const handleSendFailure = (
  error: unknown,
  options?: SendOptions,
  defaultMessage = "Error sending email:"
): false => {
  if (options?.throwOnError) {
    throw error;
  }

  console.error(defaultMessage, error);
  return false;
};

export const sendEmail = async (
  message: Omit<MailMessage, "from"> & { from?: string },
  options?: SendOptions
): Promise<boolean> => {
  const provider = getMailProvider(options?.dependencies);

  if (!provider) {
    console.warn("Mail provider is not configured. Email will not be sent.");
    return false;
  }

  try {
    const from = message.from || resolveFromEmail(options);

    if (!from) {
      return false;
    }

    await provider.sendEmail({
      ...message,
      from,
    });

    return true;
  } catch (error) {
    return handleSendFailure(error, options);
  }
};

export const sendBatchEmails = async (
  messages: Array<Omit<MailMessage, "from"> & { from?: string }>,
  options?: SendOptions
): Promise<boolean> => {
  const provider = getMailProvider(options?.dependencies);

  if (!provider) {
    console.warn("Mail provider is not configured. Email will not be sent.");
    return false;
  }

  if (messages.length === 0) {
    return true;
  }

  try {
    const resolvedMessages: MailMessage[] = messages.map((message) => ({
      ...message,
      from: message.from || resolveFromEmail(options) || "",
    }));

    if (resolvedMessages.some((message) => !message.from)) {
      return false;
    }

    await provider.sendBatchEmails(resolvedMessages);

    return true;
  } catch (error) {
    return handleSendFailure(error, options, "Failed to send batch emails:");
  }
};
