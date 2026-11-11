/** Accept generated v7 SET inputs and legacy internal string callers.
 * A null/empty update object does not assign a value; { set: null } does.
 */
export type StringUpdate = string | { set?: string | null } | null;

export const stringFromUpdate = (
  value: StringUpdate | undefined
): string | null | undefined => {
  if (typeof value === "string") return value;
  return value?.set;
};
