# Proposal: Sims 4 build auto-labeler

Status: proposed, pending parser feasibility tests. Researched September 30, 2026.

## Recommendation

Build a `sims4-build-metadata` plugin that sends uploaded build files to an isolated analysis service and returns structured facts. Let the backend translate those facts into each forum's labels. Automatically fill supported fields, show where they came from, and preserve explicit creator or moderator corrections.

The external-service idea is a good fit. The important uncertainty is whether the analyzer actually needs Windows. Start with a small headless parser prototype on both Windows and Linux. If Linux works, host the analyzer on Cloud Run alongside the existing Google Cloud storage integration. If a necessary dependency is Windows-only, keep the same service contract and use a Windows worker. Do not make desktop UI automation or launching The Sims a production dependency.

The first useful release should read lot dimensions and the build's recorded metadata. Treat complete pack dependency verification and proof of “no CC” as separate, harder capabilities. A partial answer with an honest explanation is better than an incorrect filtering label.

## What is already available

This proposal is grounded in the current backend checkout:

| Existing capability | Reuse and limitation |
| --- | --- |
| Download plugin events | `downloadableFile.created` and `.updated` exist in [constants](../services/plugin/constants.ts). Use these; do not analyze on every download. |
| External plugin execution | [downloadTrigger](../services/plugin/downloadTrigger.ts) loads a JavaScript plugin and awaits `handleEvent`. It supplies settings, decrypted server secrets, execution IDs, diagnostics, and attachment URLs. The binary parser belongs outside that process. |
| Private file access | [Private download storage](./private-download-storage.md) already supplies five-minute signed reads without persisting those URLs in run payloads. Queue messages must contain stable object identities, with a fresh read URL issued when work starts. |
| Security scanning | `security-attachment-scan` results become `scanStatus`; [prepareDownload](../customResolvers/mutations/prepareDownload.ts) checks the scan before releasing a download. Metadata analysis must have independent status and must never mark a file clean. |
| Search labels | `FilterGroup`, `FilterOption`, and `DiscussionChannel.LabelOptions` already support channel-specific labels. Labels belong to a discussion's submission in a channel, while analysis belongs to a particular file revision. |
| Label editing and history | [updateDownloadLabels](../customResolvers/mutations/updateDownloadLabels.ts) supports human edits and history. It currently takes the complete label list; automatic updates need a narrower, concurrency-safe path. |
| Operations | Plugin versions, settings, secrets, run diagnostics, execution leases, reruns, and campaign machinery already exist. Use [declarative configuration](./plugin-configuration-reconciliation.md) for repeatable installation. |

I did not find the NSFW image-scanning implementation in this checkout. The analogy is architectural: upload → external analysis → controlled backend action. The verified implementation reference here is the attachment security scanner. Labeling failure should leave metadata incomplete, rather than delete a build or block an otherwise clean download.

## Feasibility: what the files actually tell us

Sims 4 lots are distributed as a group of tray files, including `.trayitem`, `.blueprint`, and `.bpi` files. The Sims Resource's own upload guide documents that grouping and explains that its service can associate its own CC automatically. This is evidence that file-based assistance is practical, but not evidence that every external CC dependency can be resolved. [TSR upload guide](https://thesimsresource.zendesk.com/hc/en-us/articles/31357208841491-Finding-the-Content-You-Used-in-Your-Lots-Rooms-and-Sims)

There is a promising open-source starting point: [LlamaLogic](https://github.com/Llama-Logic/LlamaLogic) publishes package and protobuf libraries under MIT. Its [protobuf package](https://www.nuget.org/packages/LlamaLogic.Protobuf/1.126.58) targets several modern .NET versions. That makes portability worth testing; it does not establish a working tray-file reader or freedom from all native dependencies.

Its [Exchange schema](https://github.com/Llama-Logic/LlamaLogic/blob/main/LlamaLogic.Protobuf/Protos/Exchange.proto) includes blueprint dimensions, venue, value, bedroom/bathroom metadata, modded-content flags, and pack-related identifiers. These are useful leads, not a complete file-format specification. We still need to establish file framing, optional-field presence, version compatibility, and the meaning of pack encodings against actual exports. In particular, absent protobuf fields must not silently become authoritative zero/false values.

| Field | Initial behavior | What must be validated |
| --- | --- | --- |
| Lot size | Auto-apply after fixture validation | Decode both dimensions; preserve orientation in raw data and map to the forum's canonical size convention. |
| Lot/venue type | Auto-apply known mappings | Unknown or custom venue IDs remain unknown. |
| Packs recorded by the build | Show and apply known positive matches with “recorded by file” provenance | Validate the encodings and maintain a versioned pack catalog. An unknown ID makes completeness unknown. |
| Packs needed to reproduce the build | Initially partial/unverified | Recorded packs, referenced resources, custom venues, and CC dependencies may differ. A usable build with missing objects is not the same as an exact reproduction. |
| CC status | Show “file marked as modded,” “file not marked as modded,” or “unknown” | A false flag or absence of bundled `.package` files does not prove that no CC was used. |
| CC download links | Leave to the creator initially | Resource identifiers need a trusted catalog to resolve names, creators, links, meshes, and dependencies. Never guess links. |
| Bedrooms, bathrooms, price | Optional recorded metadata | Exported values may be stale or entered by a creator; do not call them independently verified. |

Keep `hasBundledPackages`, `fileMarkedModded`, and `dependencyAssessment` separate. A zip can include unused CC; a lot can require CC without including its packages. Unknown resources can also mean a new game patch, an incomplete official catalog, or corruption.

For the first release, do not auto-assign absolute “CC-free” or “base game only” labels. Offer weaker labels such as “No CC flagged in file” only if the forum wants that distinction. Preserve existing creator declarations as declarations, not verified facts. Later, enable stronger claims only for parser/catalog versions whose coverage has been demonstrated.

## User experience

After upload, show “Reading build details…” while the author writes the description. Once analysis finishes, populate supported fields and show a compact explanation:

> Lot size: 30×20 · Read from build file  
> Packs: 3 recorded · Additional dependencies not verified  
> CC: File marked as modded · Creator links needed

Creators should not have to approve each reliable field. They can correct a value, keep their current value when it conflicts, or request another analysis. A correction records an override so the next run does not silently undo it. Moderators can resolve disputes with the same history visible.

Publication remains possible when analysis is unavailable; fields stay manual or unknown. Security policy continues independently. Show unsupported archives and missing tray files as actionable messages, not a generic “plugin failed.”

Start with one lot per ZIP, allowing subdirectories and optional images. Validate grouping by identifiers and content, not timestamps alone. If there are multiple builds, mixed room/household content, or ambiguous groups, report that auto-labeling needs one build per upload. Do not union pack lists and sizes across alternative versions. Add explicit build selection and per-variant metadata later.

## Architecture and runtime choice

```mermaid
flowchart TD
    U[Upload build to private storage] --> S[Existing security scan]
    S -->|Clean revision| J[Durable metadata job]
    J --> P[Sims 4 plugin adapter]
    P --> A[Isolated headless analyzer]
    A --> R[Typed facts and evidence]
    R --> B[Backend validates revision and policy]
    B --> F[Stored analysis]
    F --> L[Channel label mapping and history]
    L --> UI[Upload form and search filters]
    S -->|Not clean| H[Existing security review]
```

Analyze once per immutable file revision; map the result independently into every opted-in channel. In particular, do not use the first `DiscussionChannel` selected by today's download runner as the complete list of destinations.

| Hosting option | Use when | Tradeoff |
| --- | --- | --- |
| Linux .NET service on Cloud Run | Parser works without Windows | Preferred: fits current storage integration and permits a small independently deployed service. |
| Windows Azure Function | Proven headless Windows dependency fits the function sandbox | A plausible serverless fallback, but adds another cloud's deployment, identity, and storage-egress concerns. |
| Windows VM worker in the existing cloud | Needs native installation, substantial local catalogs, or capabilities unavailable in the function sandbox | More control; baseline cost, patching, and worker recovery become our responsibility. |
| Desktop Tray Importer automation | Interactive manual validation only | Do not ship an unattended GUI workflow as the analyzer. No supported automation interface or service-use permission was established in this research. |

Cloud Run requires Linux executables, so a Windows executable cannot simply be put in a Cloud Run container. [Cloud Run runtime contract](https://docs.cloud.google.com/run/docs/container-contract)

Azure Functions supports code deployments on Windows under Consumption, Premium, and Dedicated hosting; Flex Consumption does not support Windows, and Functions does not support Windows containers. Windows Consumption is a legacy offering. A Windows function therefore needs a dependency/sandbox deployment test before selection. Its HTTP response limit is 230 seconds even when the execution plan allows longer. [Azure hosting documentation](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale)

The recommendation is conditional but concrete: first attempt a portable parser; if Windows remains necessary, try a headless Windows function. Choose a Windows VM only when measured requirements demand it. If analysis requires a running game or interactive session, reduce the automated scope rather than build around that requirement.

## Execution and integration changes

The diagram describes proposed functionality, not a queue that already exists. Today's `handleEvent` path awaits completion in the backend process; leases and a watchdog do not make an in-memory invocation durable.

For a feasibility demo, a bounded HTTP call from the plugin is enough. Before public rollout, add a durable metadata-job dispatcher with a transactionally recorded job/outbox and an independently running executor. The upload request commits the file and returns; it does not wait for analysis.

1. Record an analysis request for the committed file revision. Dispatch only after a clean security verdict for that same revision. Security failure leaves analysis blocked; a later clean rescan makes it eligible.
2. The executor claims a job, obtains a fresh signed read for its pinned storage object generation, and invokes the plugin adapter. The adapter calls the analyzer with a strict timeout.
3. Persist validated facts and conditionally apply labels only if the revision, run lease, channel policy, and override versions still match. Commit result, label changes, and audit history atomically.
4. Retry transient failures with bounded backoff; move repeatedly failing jobs to a terminal state with a user-visible rerun action. A reconciler recovers committed-but-undispatched jobs and expired leases.

Use existing run IDs, diagnostics, and lease conventions where useful. Ensure the executor can recover after process death. Begin with a synchronous analyzer response inside the durable executor; add a remote `202/jobId` protocol only if measured work cannot fit a bounded request. Never treat “job accepted” as “labels complete.”

Metadata jobs must be independent of the download gate. Do not append a slow labeler to the `downloadableFile.downloaded` pipeline. Also do not rely on `PREVIOUS_SUCCEEDED` to mean “clean”: the current runner can regard a completed non-clean security verdict as a successful plugin execution, and writes `scanStatus` after the pipeline loop. Schedule explicitly from the committed security outcome.

Use a server-installed plugin with server-managed service credentials. Make label application an explicit per-channel opt-in with configured mappings. The analyzer receives no database credentials and chooses no `FilterOption` IDs. The backend owns authorization and mapping. Existing JavaScript plugins are trusted code loaded in-process; this design isolates hostile file parsing, not arbitrary installed plugin code.

## Analysis contract and persistence

Add a server-managed `FileAnalysis` record separate from transient plugin logs. The following is an illustrative proposed response, not an existing API:

```json
{
  "schemaVersion": 1,
  "analysisId": "analysis-123",
  "downloadableFileId": "file-123",
  "fileRevision": "immutable-object-generation",
  "sha256": "sha256-of-input-bytes",
  "parserVersion": "pinned-release",
  "catalogVersion": "pinned-catalog",
  "outcome": "PARTIAL",
  "builds": [{
    "itemId": "tray-item-id",
    "kind": "LOT",
    "lotSize": {
      "value": { "x": 30, "z": 20 },
      "basis": "FILE_METADATA",
      "state": "KNOWN"
    },
    "recordedPacks": {
      "ids": ["EP01"],
      "state": "PARTIAL",
      "unknownRawIds": ["unmapped-id"]
    },
    "cc": {
      "fileMarkedModded": true,
      "hasBundledPackages": false,
      "dependencyAssessment": "UNVERIFIED"
    }
  }],
  "diagnostics": [{ "code": "UNKNOWN_PACK_ID" }]
}
```

Retain evidence locations, parsing warnings, timestamps, plugin/run identity, and mapping-policy version alongside facts. Use explicit field states such as `KNOWN`, `PARTIAL`, `UNKNOWN`, and `CONFLICT`; avoid invented confidence percentages. Terminal outcomes distinguish complete, partial, unsupported, and failed analysis. An unsupported game version is not an empty set of dependencies.

Pin storage generations and add a durable revision identity: the current schema has storage paths but no explicit generation/content hash fields. Bind analysis and security decisions to the same bytes. Validate returned identities against the job; do not trust them simply because they appear in JSON. Represent large game IDs as strings to avoid JavaScript integer precision loss.

Cache within the deployment by `(content hash, parser version, catalog version, analysis options)`. Mapping changes can reuse facts; parser/catalog changes require reanalysis. Authorize access through the current file even on cache hits. The worker cannot reuse another uploader's result to expose private metadata.

## Label ownership, overrides, and filtering

Store provenance for each automated assignment: analysis ID, field, source file revision, channel policy, and whether a human has overridden it. Extend label history to identify the plugin as actor rather than inventing a user account.

Automatic application may update only mapped groups and only the assignments it owns. Preserve unrelated style/theme labels. Removing a detected label counts as an explicit suppression, so reruns do not re-add it. A fresh upload invalidates the old analysis immediately; keep prior facts for history but remove their current verified status. Notify the creator to review overrides on the new revision rather than silently converting them into new facts.

Mapping configuration uses stable group keys and canonical values, resolving to options belonging to the target channel. Validate uniqueness and reject ambiguous mappings. Missing options produce diagnostics; the worker must not create new public taxonomy entries automatically. Cross-posting into a new channel applies that channel's policy to the current facts without re-parsing the file.

Search semantics need special attention. “Does not require Pack X” cannot mean “has no Pack X label,” because an unanalyzed or partially analyzed build would pass. Store per-group completeness and expose it to queries. For dependency compatibility filters, require a complete assessment and a required-pack set that is a subset of the user's owned packs. Give users an explicit choice to include unverified builds. Exact size matching can work independently when lot size is known but dependencies are not.

## Isolation and operational limits

Treat archives as untrusted input even after a clean malware scan. Use a maintained extractor, reject traversal/absolute paths and links, enforce limits on expanded bytes, entry count, nesting, memory, and execution time, and clean temporary files after every attempt. Do not execute uploaded scripts or binaries. Ignore optional images for metadata parsing. Defer password-protected archives, RAR, and 7z until separately supported.

Allow reads only from approved storage locations; do not fetch arbitrary URLs found inside the archive or follow redirects into private networks. Restrict analyzer network access, use authenticated service requests, and keep signed URLs and user file contents out of logs. Persist only the facts needed for labels and diagnostics, with authorization matching the source discussion's visibility and age restrictions.

A low-volume pilot should cap worker concurrency and retries. Measure queue delay, analysis time, memory, cache hit rate, failures by game/parser version, partial-result rate, and override/disagreement rate. Cost is worker runtime plus any baseline Windows capacity, storage operations, transfer, and maintenance; quote a dollar estimate only after fixture benchmarks and expected upload volume are known.

## Delivery plan and acceptance criteria

### 1. Parser feasibility spike

Collect creator-approved exports with known in-game metadata: base-game builds, several pack combinations, current kits, CC without bundled packages, bundled but unused CC, custom venues, older exports, and missing/malformed file sets. Compare against the game and a trusted desktop tool as independent references.

Produce a CLI taking a ZIP and emitting the proposed JSON on Windows and Linux. Demonstrate actual tray framing and optional-field handling, not just protobuf deserialization. Determine which pack fields describe saved dependencies versus other metadata. Inventory native/game-install dependencies and applicable redistribution terms before choosing a library and host. No backend label writes in this stage.

Exit decision: a tested field-support matrix and hosting choice. If only dimensions are dependable, ship that useful subset and leave dependency claims manual.

### 2. Shadow-mode integration

Add revision tracking, durable dispatch, typed result validation, `FileAnalysis`, and safe diagnostics. Run for one opted-in Sims channel without changing labels. Test restarts, duplicate deliveries, stale results after replacement/deletion, and signed-URL expiration. Compare proposed labels to human labels and investigate disagreements.

### 3. Automatic supported labels

Add channel mappings, assignment provenance, overrides, transactional history, and upload-form feedback. Enable lot size and other validated fields first. Add recorded-pack labels only with clear semantics. Add completeness-aware filtering before presenting negative compatibility claims.

### 4. Broader dependency resolution

Evaluate a maintained resource-to-pack catalog and trusted CC catalogs, then expand to complete dependency claims only where evidence supports them. Add multiple-build archives, rooms, and households as separate scopes. Backfill older uploads gradually after measuring load; reuse campaign controls where compatible with the new job lifecycle.

Acceptance requires correct expected outputs on the approved fixtures; no automatic “CC-free”/“base game only” result from missing data; no stale or duplicate label writes; preservation of overrides; no cross-channel label contamination; and clean downloads remaining usable when labeling fails. Verify that unknown dependencies cannot pass strict compatibility filters. Target at least 80% coverage for new code, with meaningful parser fixtures, job recovery tests, and authorization/concurrency integration tests.

Roll back by disabling automatic application and dispatch while retaining human labels and audit history. A bad parser release can be pinned back, affected assignments identified by provenance, and reanalysis scheduled without deleting downloads.

## Decisions to make after the spike

The defaults above are sufficient to start research. The implementation decision needs three concrete results: whether headless Linux parsing works, which pack/CC claims are supported by representative exports, and whether the first pilot's size/latency needs fit a function. The largest uncertainty is trustworthy dependency interpretation, not running the plugin adapter.
