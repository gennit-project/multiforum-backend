# Sims 4 metadata portability spike

**Finding: Windows is not required to read tray metadata from the supplied lots.**
The same pinned .NET library and probe produced identical results on macOS and
Linux. This establishes a viable portable metadata layer, not a complete build
dependency analyzer. There is no backend integration or automatic labeling here.

Design: [draft PR #317](https://github.com/gennit-project/multiforum-backend/pull/317).

## Experiment

Tested on September 30, 2026 using the user-provided
`test_data_july_21_2025` directory. The user described these as re-uploaded
game-supplied lots with no CC and requiring at least the Pets pack. That is the
expected ground truth, not a property inferred by the probe.

The probe uses `LlamaLogic.Protobuf` **1.126.58**, pinned with NuGet lockfiles,
and targets .NET 9 to match the locally available SDK. It runs headlessly without
The Sims, Tray Importer, a game installation, Windows APIs, or a desktop session.

| Environment actually executed | Result |
| --- | --- |
| macOS, x64, SDK 9.0.300 / runtime 9.0.5 | All 13 records parsed; 13 regression tests passed |
| Debian 12 Linux container, x64, runtime 9.0.20 | All 13 records parsed; 13 regression tests passed |
| Windows | Not executed; neither of the successful environments requires it |

The Linux SDK image is pinned by digest in `run-linux.sh`. Source and fixtures
are mounted read-only. Compilation occurs in the disposable container; only
results and test reports are written back.

The directory contains seven loose `.trayitem` files and six outer ZIPs. One
outer ZIP contains another ZIP. Ignoring Mac sidecars, these yielded **13
records representing six distinct tray-file hashes**. All result fields,
including relative source paths and SHA-256 hashes, matched across operating
systems. The ZIP copies matched their loose counterparts.

## Observations from the actual files

| Name inside tray metadata | Size | Recorded modded flag | Raw `sku_id` | Number of copies read |
| --- | --- | --- | --- | --- |
| Salty Paws Saloon | 20×15 | false | 536870912 | 4 |
| Desert Bloom | 50×50 | true | 16 | 2 |
| The Roadstead | 40×30 | true | 128 | 2 |
| Bedlington Boathouse | 20×20 | true | 4948339195904 | 2 |
| Chateau Frise | 40×40 | true | 70369281048576 | 2 |
| Slipshod Mesquite | 40×30 | false | 16 | 1 |

All records had metadata version `11600`, explicit `sku2_id = 0`, absent
`sku_bits`, and absent `is_image_modded_content`. Several contained `mtx_ids`;
these are preserved as raw IDs and are not labeled as packs or CC.

Two findings matter for product behavior:

1. **Four of the six distinct lots have `is_modded_content = true`, despite the
   user's no-CC expectation.** An independent Python wire-level inspection of
   the loose files confirmed that the boolean is explicitly encoded as 1;
   this is not the library substituting a default. The cause is unresolved.
   Do not translate the flag directly into “requires CC,” and do not translate
   false into “verified CC-free.”
2. **The `Havisham_House` ZIP and folder contain Salty Paws Saloon metadata.**
   Their tray-file SHA-256 is identical to the Salty Paws Saloon copies:
   `32f3c6588af59252c873eec0856a1c4648b28cf0563bddf330f4516e0fb62afd`.
   This confirms a metadata/content naming mismatch; it does not independently
   compare every blueprint or image byte. The analyzer must not label from
   the upload filename alone.

The **Cats & Dogs requirement is not yet verified**. This probe deliberately
leaves pack fields uninterpreted. Matching a set bit to a catalog number without
establishing the encoding would produce plausible but potentially wrong labels.
The varied raw values also mean the user's expectation needs checking per lot,
rather than treating every fixture as having the same dependencies.

## What the code does

- Reads `.trayitem` files directly, through a directory tree, or inside ZIPs.
- Supports one nested ZIP level because the provided Bedlington fixture needs it.
- Ignores `__MACOSX` entries and AppleDouble `._` files.
- Checks the observed eight-byte framing: a zero uint32 followed by a
  little-endian uint32 equal to the remaining payload length.
- Deserializes `TrayMetadata` and requires explicit identity, blueprint type,
  and blueprint metadata. It does not scan for plausible protobuf offsets.
- Preserves optional-field absence separately from false/zero, and emits
  64-bit identifiers as strings to avoid loss of precision in JavaScript.
- Reports raw metadata and hashes with `dependencyAssessment: UNVERIFIED`.
- Does not extract files or execute uploaded content. Caps metadata at 4 MiB,
  outer/nested archives at 32 MiB, relevant expanded bytes at 32 MiB per outer
  archive, and archive entries at 10,000 per outer archive.

This remains a local research tool. It does not validate matching blueprint/BPI
sets, parse build resources, implement a hardened service sandbox, impose a
global directory-wide budget, or support every past/future tray format. A
matching header and deserializable protobuf do not prove compatibility with an
untested game version. Malformed/unsupported input exits unsuccessfully rather
than emitting partial success; a production analyzer will need per-build errors.

## Reproduce

From this directory, with .NET 9 installed:

```sh
dotnet restore Tests/Tests.csproj --locked-mode
dotnet test Tests/Tests.csproj --no-restore --collect:"XPlat Code Coverage" --results-directory TestResults
mkdir -p results
dotnet Probe/bin/Debug/net9.0/Probe.dll /absolute/path/to/test_data_july_21_2025 > results/macos.json
bash run-linux.sh /absolute/path/to/test_data_july_21_2025
```

The executable also accepts an individual `.trayitem` or ZIP path. The first
restore downloads the pinned packages. The Linux script requires Docker and
network access for its first image/package downloads. It does not upload fixture
content. Paths containing commas are not supported by its Docker mount syntax.

Compare the records, excluding the deliberately different runtime/OS envelope:

```sh
python3 - <<'PY'
import json
from pathlib import Path
root = Path('results')
mac = json.loads((root / 'macos.json').read_text())
linux = json.loads((root / 'linux.json').read_text())
assert mac['results'] == linux['results']
print(f"Identical: {len(mac['results'])} records")
PY
```

Raw outputs, NuGet caches, binaries, and coverage reports are ignored by Git.
The user-provided game files are not copied into the repository. Only synthetic
fixtures constructed inside tests are distributed with the code.

## Validation and remaining work

The 13 regression cases exercise independently hand-encoded protobuf data,
absent/false/true flags, exact 64-bit identifiers, optional fields, invalid
framing, malformed payloads, non-lot payloads, nested archives, Mac sidecars,
size limits, and empty inputs. Measured coverage: **107/126 lines (84.9%)** and
**92/104 branches (88.5%)**, including the CLI entry point (not covered by unit tests)
in the denominator. The actual CLI was separately exercised against all supplied
fixtures on both platforms. Coverage is a spike baseline, not evidence that the
reader is ready for hostile public uploads.

Next experiments:

1. Compare each lot's dimensions and pack list with the in-game Gallery or a
   trusted desktop tool. Keep creator expectations separate from recorded facts.
2. Establish the semantics and versioning of `sku_id`, `sku2_id`, `sku_bits`,
   and `mtx_ids` using controlled exports with exactly one changed pack/object.
3. Obtain paired exports with known CC added/removed and investigate why these
   no-CC fixtures record the modded flag. Preserve those as regression cases.
4. Verify blueprint/resource parsing and matching file sets on Linux. That
   capability could introduce new dependencies, so portability of metadata alone
   must not be reported as portability of full CC dependency resolution.
5. Test newer exports and unsupported-version handling before service integration.

**Architecture implication:** prefer a Linux analyzer for the metadata MVP.
Keep the analyzer boundary from the design, but do not provision a Windows
worker unless a later, specifically identified capability actually requires it.

## Sources and provenance

- [Published library version tested](https://www.nuget.org/packages/LlamaLogic.Protobuf/1.126.58).
- [Upstream Exchange schema](https://github.com/Llama-Logic/LlamaLogic/blob/58e103b92cee0f90224f81c86f44747cd7da14d1/LlamaLogic.Protobuf/Protos/Exchange.proto)
  and [generated classes](https://github.com/Llama-Logic/LlamaLogic/blob/58e103b92cee0f90224f81c86f44747cd7da14d1/LlamaLogic.Protobuf/Exchange.cs)
  inspected during research. This repository commit is newer than the NuGet
  release; compilation and execution against the pinned package establish the
  actual API used, rather than assuming the source checkout and package match.
- [Community tray-format research](https://modthesims.info/wiki.php?title=Sims_4:0x2A8A5E22)
  provided a framing hypothesis, subsequently checked against the supplied files.
  It is incomplete historical documentation, not an official format guarantee.

The upstream library is MIT-licensed; it is referenced through NuGet, not vendored.
