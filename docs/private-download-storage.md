# Private download storage

Downloadable files use a dedicated private Google Cloud Storage bucket. Publicly
rendered images and media remain in `GCS_BUCKET_NAME`; downloads are uploaded to
`GCS_PRIVATE_DOWNLOAD_BUCKET_NAME` and are read only through short-lived signed
URLs after the download security gate succeeds.

## Bucket setup

Create a bucket for downloads and grant the backend service account permission
to create, read, copy, and delete objects. Do not grant `allUsers` or
`allAuthenticatedUsers` access. Set `GCS_PRIVATE_DOWNLOAD_BUCKET_NAME` on every
backend instance before deploying the frontend that requests private download
uploads.

The scanner receives a five-minute signed read URL. Signed URLs are not written
to `PluginRun` payloads; stored payloads retain only the canonical, non-public
object URL.

## Existing downloads

The migration command is a dry run unless `--apply` is supplied:

```sh
pnpm run migrate:private-downloads
pnpm run migrate:private-downloads -- --apply
```

Run the apply command in a maintenance window so uploads and replacements are
paused. For each `DownloadableFile` with storage metadata, it copies the object
to the private bucket, removes the source object, and conditionally updates the
file and upload-audit metadata. It is safe to rerun after interruption because
an existing destination object is reused and missing source objects are ignored.

URL-only legacy downloads cannot be migrated automatically because the backend
does not own their storage. They continue to use their existing URL and should
be reviewed separately.
