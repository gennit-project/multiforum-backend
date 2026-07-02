// Normalizes the result of `hasServerModPermission` into a graphql-shield
// verdict. In practice that function returns `true | Error`, but its declared
// return type allows `false`, so callers historically handled the falsy case
// inconsistently:
//
//   - canLockChannel / canPermanentlyRemoveImage: a falsy (non-Error)
//     result denies (returns false).
//   - canArchiveAndUnarchiveImage (server scope): a falsy result is treated
//     as allowed (returns true).
//
// `denyOnFalsy` makes destructive permission checks fail closed while preserving
// older behavior for callers that intentionally leave it false.
// (The falsy branch is currently unreachable given hasServerModPermission's
// real returns; the flag documents intent and protects future changes.)
export function normalizeServerModPermissionResult(
  result: boolean | Error,
  { denyOnFalsy = false }: { denyOnFalsy?: boolean } = {}
): boolean | Error {
  if (denyOnFalsy && !result) {
    return false;
  }
  if (result instanceof Error) {
    return result;
  }
  return true;
}
