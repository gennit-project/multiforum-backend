# Image variant storage

`Image`, `User`, and `Channel` expose `variantUrls: JSON`. Neo4j cannot store a
map as a node property. The image-write repository encodes URL maps as JSON text
in the existing `variantUrls` property before image creation, profile-image
updates, or channel-icon updates. Public GraphQL responses decode this text back
to a map; the public schema is unchanged. URLs and keys are stored verbatim.

The existing individual URL properties (`list80Url`, `avatar32Url`, `icon32Url`,
etc.) are still written. The field resolver merges them with the stored map and
retains their existing precedence. It accepts both JSON text and in-memory maps,
and preserves scalar-only legacy records. Empty maps resolve to null, as before.
Malformed legacy JSON text does not prevent the scalar fallback from working.

No migration or production write is needed. A null repository update removes the
map property; an omitted update preserves it. Neither operation clears the
individual URL properties. Empty variant generation continues to omit variant
updates, preserving the existing behavior. This fix does not introduce a policy
for deleting old variants on image replacement.

The encoding is confined to the domain-owned image-write repository. It does not
change the generic JSON scalar or other JSON properties. Generic generated CRUD
operations are not a new supported path for writing variant maps. Any future
variant writer should use the same repository boundary rather than passing a map
directly to Neo4j.

Authorization, upload-audit ownership and claim ordering are unchanged. Image
creation still falls back to the original image when variant generation fails;
profile and icon updates still propagate generation failures. A failed image/profile/icon
persistence write must remain uncommitted and leave the upload audit unclaimed. Integration tests
exercise these paths using the real schema, Shield middleware, deterministic
variant generation, and disposable Neo4j, with native storage/HTTP disabled.
