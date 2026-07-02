const uploadAuditFieldNames = [
  "storageBucket",
  "storageObjectName",
  "storageUrl",
  "uploadedAt",
  "uploadedByUsername",
  "uploadedByIp",
] as const;

export const getAttemptedUploadAuditFields = (
  input: Record<string, unknown> | null | undefined
): string[] => {
  if (!input) {
    return [];
  }

  return uploadAuditFieldNames.filter((fieldName) =>
    Object.prototype.hasOwnProperty.call(input, fieldName)
  );
};

export const uploadAuditFieldsError = (attempted: string[]) =>
  `Upload audit fields cannot be modified (${attempted.join(", ")})`;
