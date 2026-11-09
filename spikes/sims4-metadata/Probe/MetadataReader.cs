using System.Buffers.Binary;
using System.Security.Cryptography;
using EA.Sims4.Network;
using ProtoBuf;

namespace Sims4Spike;

public static class MetadataReader
{
    public static MetadataResult Inspect(string source, byte[] data)
    {
        if (data.Length > 4 * 1024 * 1024) throw new InvalidDataException("Metadata exceeds spike limit.");
        if (data.Length < 8 || BinaryPrimitives.ReadUInt32LittleEndian(data) != 0 ||
            BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(4)) != data.Length - 8)
            throw new InvalidDataException("Unrecognized tray framing: " + source);
        using var stream = new MemoryStream(data, 8, data.Length - 8);
        var tray = Serializer.Deserialize<TrayMetadata>(stream);
        if (!tray.ShouldSerializeId() || !tray.ShouldSerializeType() || tray.Type != ExchangeItemTypes.ExchangeBlueprint || tray.Metadata?.BpMetadata == null)
            throw new InvalidDataException("Not a supported lot metadata record.");
        var metadata = tray.Metadata;
        var bp = metadata?.BpMetadata;
        return new MetadataResult
        {
            source = source,
            sha256 = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant(),
            id = tray.ShouldSerializeId() ? tray.Id.ToString() : null,
            name = tray.Name,
            type = tray.Type.ToString(),
            sizeX = bp?.ShouldSerializeSizeX() == true ? (uint?)bp.SizeX : null,
            sizeZ = bp?.ShouldSerializeSizeZ() == true ? (uint?)bp.SizeZ : null,
            modded = metadata?.ShouldSerializeIsModdedContent() == true ? (bool?)metadata.IsModdedContent : null,
            imageModded = metadata?.ShouldSerializeIsImageModdedContent() == true ? (bool?)metadata.IsImageModdedContent : null,
            skuId = metadata?.ShouldSerializeSkuId() == true ? metadata.SkuId.ToString() : null,
            sku2Id = metadata?.ShouldSerializeSku2Id() == true ? metadata.Sku2Id.ToString() : null,
            skuBits = metadata?.SkuBits,
            mtxIds = tray.MtxIds?.Select(x => x.ToString()).ToArray(),
            metadataVersion = metadata?.ShouldSerializeVersion() == true ? (uint?)metadata.Version : null,
            dependencyAssessment = "UNVERIFIED"
        };
    }

}

public sealed record MetadataResult
{
    public required string source { get; init; }
    public required string sha256 { get; init; }
    public string? id { get; init; }
    public string? name { get; init; }
    public string? type { get; init; }
    public uint? sizeX { get; init; }
    public uint? sizeZ { get; init; }
    public bool? modded { get; init; }
    public bool? imageModded { get; init; }
    public string? skuId { get; init; }
    public string? sku2Id { get; init; }
    public uint[]? skuBits { get; init; }
    public string[]? mtxIds { get; init; }
    public uint? metadataVersion { get; init; }
    public required string dependencyAssessment { get; init; }
}
