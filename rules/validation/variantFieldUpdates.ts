const getAttemptedFields = (
  input: Record<string, unknown> | null | undefined,
  fieldNames: readonly string[]
): string[] => {
  if (!input) {
    return [];
  }

  return fieldNames.filter((fieldName) =>
    Object.prototype.hasOwnProperty.call(input, fieldName)
  );
};

const formatVariantFieldsError = (
  context:
    | "updateUsers"
    | "updateChannels"
    | "image updates"
    | "event updates",
  attempted: string[]
) =>
  `${
    context === "image updates"
      ? "Backend-managed image fields"
      : "Image variant fields"
  } cannot be assigned through ${context} (${attempted.join(
    ", "
  )}). They are managed by backend image processing.`;

const userVariantFieldNames = [
  "variantUrls",
  "avatar32Url",
  "avatar48Url",
  "avatar64Url",
  "avatar96Url",
] as const;

const imageVariantFieldNames = [
  "width",
  "height",
  "variantUrls",
  "list80Url",
  "list160Url",
  "list320Url",
  "detail640Url",
  "detail960Url",
  "detail1280Url",
] as const;

const eventVariantFieldNames = ["variantUrls"] as const;

const channelVariantFieldNames = [
  "variantUrls",
  "icon32Url",
  "icon48Url",
  "icon64Url",
  "icon96Url",
] as const;

export const getAttemptedUserVariantFields = (
  input: Record<string, unknown> | null | undefined
): string[] => getAttemptedFields(input, userVariantFieldNames);

export const userVariantFieldsError = (attempted: string[]) =>
  formatVariantFieldsError("updateUsers", attempted);

export const getAttemptedImageVariantFields = (
  input: Record<string, unknown> | null | undefined
): string[] => getAttemptedFields(input, imageVariantFieldNames);

export const imageVariantFieldsError = (attempted: string[]) =>
  formatVariantFieldsError("image updates", attempted);

export const getAttemptedEventVariantFields = (
  input: Record<string, unknown> | null | undefined
): string[] => getAttemptedFields(input, eventVariantFieldNames);

export const eventVariantFieldsError = (attempted: string[]) =>
  formatVariantFieldsError("event updates", attempted);

export const getAttemptedChannelVariantFields = (
  input: Record<string, unknown> | null | undefined
): string[] => getAttemptedFields(input, channelVariantFieldNames);

export const channelVariantFieldsError = (attempted: string[]) =>
  formatVariantFieldsError("updateChannels", attempted);
