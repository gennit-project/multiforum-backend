# hasDownload Filter Logic

## Problem
- New discussions have `hasDownload: false` explicitly set
- Older discussions have `hasDownload: null` (field didn't exist when they were created)
- Users searching for `hasDownload: false` should get both explicit `false` values AND `null` values
- `hasDownload: true` is also used by the frontend to choose the download-style layout, so it cannot be treated as the only source of truth for whether a discussion belongs in a public download list

## Solution
Updated the Cypher query filter logic to handle this properly:

### Before:
```cypher
AND ($hasDownload IS NULL OR d.hasDownload = $hasDownload)
```

### After:
```cypher
AND (
  $hasDownload IS NULL OR
  (
    $hasDownload = true AND
    d.hasDownload = true AND
    EXISTS { MATCH (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile) }
  ) OR
  (
    $hasDownload = false AND
    (d.hasDownload = false OR d.hasDownload IS NULL)
  )
)
```

## How It Works

### When `$hasDownload` is `null/undefined`:
- **Behavior**: Returns all discussions (no filtering)
- **Query Logic**: `$hasDownload IS NULL` is true, so the entire condition passes

### When `$hasDownload` is `true`:
- **Behavior**: Returns only discussions with explicit `hasDownload: true` and at least one attached `DownloadableFile`
- **Query Logic**: `$hasDownload = true AND d.hasDownload = true AND EXISTS { MATCH (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile) }`
- **Results**: Public download lists exclude orphaned downloads, but detail pages can still render in download layout because the `hasDownload` flag remains unchanged

### When `$hasDownload` is `false`:
- **Behavior**: Returns discussions with `hasDownload: false` OR `hasDownload: null`
- **Query Logic**: `$hasDownload = false AND (d.hasDownload = false OR d.hasDownload IS NULL)`
- **Results**: Both new discussions (explicit `false`) and old discussions (`null`)

## Usage Examples

```graphql
# Get all discussions (no filter)
getSiteWideDiscussionList(hasDownload: null) 

# Get only discussions with downloads
getSiteWideDiscussionList(hasDownload: true)

# Get discussions without downloads (includes old null values)
getSiteWideDiscussionList(hasDownload: false)
```

## Applied To:
- ✅ `getSiteWideDiscussionsQuery.cypher` (both count and main query sections)
- ✅ `getDiscussionChannelsQuery.cypher` (both count and main query sections)

This keeps `hasDownload` as the frontend presentation flag while making public download lists require an actual attached file.
