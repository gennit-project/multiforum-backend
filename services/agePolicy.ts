export const DEFAULT_ACCOUNT_MINIMUM_AGE = 13;
export const DEFAULT_SENSITIVE_CONTENT_MINIMUM_AGE = 18;
export const MINIMUM_CONFIGURABLE_AGE = 1;
export const MAXIMUM_CONFIGURABLE_AGE = 120;

export type AgePolicy = {
  accountAgeGateEnabled: boolean;
  minimumAccountAge: number;
  sensitiveContentAgeGateEnabled: boolean;
  minimumSensitiveContentAge: number;
};

export const DEFAULT_AGE_POLICY: AgePolicy = {
  accountAgeGateEnabled: false,
  minimumAccountAge: DEFAULT_ACCOUNT_MINIMUM_AGE,
  sensitiveContentAgeGateEnabled: false,
  minimumSensitiveContentAge: DEFAULT_SENSITIVE_CONTENT_MINIMUM_AGE,
};

type ServerAgeConfig = Partial<{
  accountAgeGateEnabled: boolean | null;
  minimumAccountAge: number | null;
  sensitiveContentAgeGateEnabled: boolean | null;
  minimumSensitiveContentAge: number | null;
}>;

type ServerConfigReader = {
  find(options: {
    where: { serverName: string };
    selectionSet: string;
  }): Promise<ServerAgeConfig[]>;
};

export function normalizeAgePolicy(config?: ServerAgeConfig | null): AgePolicy {
  return {
    accountAgeGateEnabled:
      config?.accountAgeGateEnabled ?? DEFAULT_AGE_POLICY.accountAgeGateEnabled,
    minimumAccountAge:
      config?.minimumAccountAge ?? DEFAULT_AGE_POLICY.minimumAccountAge,
    sensitiveContentAgeGateEnabled:
      config?.sensitiveContentAgeGateEnabled ??
      DEFAULT_AGE_POLICY.sensitiveContentAgeGateEnabled,
    minimumSensitiveContentAge:
      config?.minimumSensitiveContentAge ??
      DEFAULT_AGE_POLICY.minimumSensitiveContentAge,
  };
}

export async function loadAgePolicy(
  ServerConfig: ServerConfigReader,
  serverName = process.env.SERVER_CONFIG_NAME
): Promise<AgePolicy> {
  if (!serverName) {
    return DEFAULT_AGE_POLICY;
  }

  const configs = await ServerConfig.find({
    where: { serverName },
    selectionSet: `{
      accountAgeGateEnabled
      minimumAccountAge
      sensitiveContentAgeGateEnabled
      minimumSensitiveContentAge
    }`,
  });

  return normalizeAgePolicy(configs[0]);
}

export function parseBirthday(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

export function calculateAge(
  birthday: string,
  now: Date = new Date()
): number | null {
  const birthDate = parseBirthday(birthday);
  if (!birthDate) return null;

  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const birthdayHasNotOccurred =
    now.getUTCMonth() < birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() &&
      now.getUTCDate() < birthDate.getUTCDate());

  if (birthdayHasNotOccurred) age -= 1;
  return age;
}

export function validateRegistrationBirthday(input: {
  birthday?: string | null;
  policy: AgePolicy;
  now?: Date;
}): void {
  const { birthday, policy, now = new Date() } = input;
  const birthdayRequired =
    policy.accountAgeGateEnabled || policy.sensitiveContentAgeGateEnabled;

  if (!birthday) {
    if (birthdayRequired) {
      throw new Error("BIRTHDAY_REQUIRED");
    }
    return;
  }

  const age = calculateAge(birthday, now);
  if (age === null || age < 0) {
    throw new Error("INVALID_BIRTHDAY");
  }

  if (policy.accountAgeGateEnabled && age < policy.minimumAccountAge) {
    throw new Error("MINIMUM_AGE_NOT_MET");
  }
}

export function getAgeEligibility(input: {
  birthday?: string | null;
  policy: AgePolicy;
  now?: Date;
}) {
  const { birthday, policy, now = new Date() } = input;
  const age = birthday ? calculateAge(birthday, now) : null;

  return {
    meetsAccountMinimumAge:
      age === null ? null : age >= policy.minimumAccountAge,
    mayAccessSensitiveContent:
      !policy.sensitiveContentAgeGateEnabled ||
      (age !== null && age >= policy.minimumSensitiveContentAge),
  };
}

export function validateMinimumAge(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MINIMUM_CONFIGURABLE_AGE &&
    value <= MAXIMUM_CONFIGURABLE_AGE
  );
}
