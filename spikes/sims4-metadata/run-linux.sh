#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
  echo 'Usage: bash run-linux.sh /absolute/path/to/fixture-directory' >&2
  exit 2
fi

spike_dir="$(cd "$(dirname "$0")" && pwd)"
fixture_dir="$(cd "$1" && pwd)"
mkdir -p "$spike_dir/results"

docker run --rm \
  --mount "type=bind,source=$spike_dir,target=/src,readonly" \
  --mount "type=bind,source=$fixture_dir,target=/fixtures,readonly" \
  --mount "type=bind,source=$spike_dir/results,target=/out" \
  --env DOTNET_CLI_TELEMETRY_OPTOUT=1 \
  mcr.microsoft.com/dotnet/sdk@sha256:01fabc4758d1d74e39eda700c8463dae6241a61481f973683692ddcb59a5eeb7 \
  sh -c 'set -eu
    mkdir -p /work/Probe /work/Tests
    cp /src/Probe/*.cs /src/Probe/*.csproj /src/Probe/packages.lock.json /work/Probe/
    cp /src/Tests/*.cs /src/Tests/*.csproj /src/Tests/packages.lock.json /work/Tests/
    dotnet restore /work/Tests/Tests.csproj --locked-mode
    dotnet test /work/Tests/Tests.csproj --no-restore --collect:"XPlat Code Coverage" --results-directory /out/linux-tests --nologo
    dotnet /work/Probe/bin/Debug/net9.0/Probe.dll /fixtures > /out/linux.json'
