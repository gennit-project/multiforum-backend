using System.Buffers.Binary;
using System.IO.Compression;
using EA.Sims4.Network;
using ProtoBuf;
using Sims4Spike;
using Xunit;

public sealed class ReaderTests : IDisposable
{
    readonly string directory = Path.Combine(Path.GetTempPath(), "sims4-probe-" + Guid.NewGuid());
    public ReaderTests() => Directory.CreateDirectory(directory);
    public void Dispose() => Directory.Delete(directory, recursive: true);

    // Independent, hand-encoded protobuf: id=1, type=blueprint, metadata.bp=(30,20).
    static byte[] KnownWire(bool? modded = null) => Frame(Convert.FromHexString(modded switch {
        true => "0801100252080A04101E18142801",
        false => "0801100252080A04101E18142800",
        _ => "0801100252060A04101E1814"
    }));

    static byte[] Frame(byte[] payload)
    {
        var bytes = new byte[payload.Length + 8];
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), (uint)payload.Length);
        payload.CopyTo(bytes, 8);
        return bytes;
    }

    static byte[] Encode(TrayMetadata tray)
    {
        using var stream = new MemoryStream();
        Serializer.Serialize(stream, tray);
        return Frame(stream.ToArray());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    [InlineData(null)]
    public void ReadsIndependentWireWithoutConflatingAbsentAndFalse(bool? modded)
    {
        var result = MetadataReader.Inspect("fixture", KnownWire(modded));
        Assert.Equal((uint)30, result.sizeX);
        Assert.Equal((uint)20, result.sizeZ);
        Assert.Equal(modded, result.modded);
        Assert.Equal("UNVERIFIED", result.dependencyAssessment);
        Assert.Null(result.skuId);
        Assert.Null(result.imageModded);
    }

    [Fact]
    public void PreservesLargeIdsAndOptionalFields()
    {
        var result = MetadataReader.Inspect("fixture", Encode(new TrayMetadata {
            Id = ulong.MaxValue, Type = ExchangeItemTypes.ExchangeBlueprint,
            Name = "Synthetic", MtxIds = [ulong.MaxValue],
            Metadata = new() {
                BpMetadata = new(), SkuId = ulong.MaxValue, Sku2Id = 0,
                SkuBits = [29], IsImageModdedContent = false, Version = 11600
            }
        }));
        Assert.Equal("18446744073709551615", result.id);
        Assert.Equal(result.id, result.skuId);
        Assert.Equal("0", result.sku2Id);
        Assert.Equal(result.id, Assert.Single(result.mtxIds!));
        Assert.Equal((uint)29, Assert.Single(result.skuBits!));
        Assert.False(result.imageModded);
        Assert.Null(result.sizeX);
        Assert.Null(result.sizeZ);
        Assert.Equal((uint)11600, result.metadataVersion);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public void RejectsUnrecognizedFraming(int mutation)
    {
        var bytes = KnownWire();
        if (mutation == 0) bytes = bytes[..7];
        if (mutation == 1) bytes[0] = 1;
        if (mutation == 2) bytes[4]++;
        if (mutation == 3) bytes = [..bytes, 0];
        Assert.Throws<InvalidDataException>(() => MetadataReader.Inspect("fixture", bytes));
    }

    [Fact]
    public void RejectsMalformedProtobufAndNonLotPayload()
    {
        Assert.ThrowsAny<Exception>(() => MetadataReader.Inspect("fixture", Frame([0x52, 0xff])));
        Assert.Throws<InvalidDataException>(() => MetadataReader.Inspect("fixture", Frame([])));
        Assert.Throws<InvalidDataException>(() => MetadataReader.Inspect("fixture", Encode(new TrayMetadata {
            Id = 1, Type = ExchangeItemTypes.ExchangeHousehold, Metadata = new() { BpMetadata = new() }
        })));
    }

    static byte[] Zip(params (string Name, byte[] Bytes)[] entries)
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
            foreach (var (name, bytes) in entries)
            {
                using var content = archive.CreateEntry(name).Open();
                content.Write(bytes);
            }
        return stream.ToArray();
    }

    [Fact]
    public void ReadsLooseZipAndNestedZipAndIgnoresMacSidecars()
    {
        File.WriteAllBytes(Path.Combine(directory, "lot.trayitem"), KnownWire());
        File.WriteAllBytes(Path.Combine(directory, "._lot.trayitem"), [1]);
        File.WriteAllBytes(Path.Combine(directory, "image.png"), [1]);
        File.WriteAllBytes(Path.Combine(directory, "lots.zip"), Zip(
            ("folder/lot.trayitem", KnownWire()),
            ("__MACOSX/._lot.trayitem", [1]),
            ("image.png", [1]),
            ("nested.zip", Zip(("lot.trayitem", KnownWire())))));
        var results = InputReader.Read(directory).ToArray();
        Assert.Equal(3, results.Length);
        Assert.Single(results.Select(r => r.sha256).Distinct());
        Assert.Equal(2, InputReader.Read(Path.Combine(directory, "lots.zip")).Count());
    }

    [Fact]
    public void RejectsDeepArchives()
    {
        var path = Path.Combine(directory, "deep.zip");
        File.WriteAllBytes(path, Zip(("one.zip", Zip(("two.zip", Zip(("lot.trayitem", KnownWire())))))));
        Assert.Throws<InvalidDataException>(() => InputReader.Read(path).ToArray());
    }

    [Fact]
    public void RejectsOversizeMetadataAndArchives()
    {
        var large = new byte[4 * 1024 * 1024 + 1];
        Assert.Throws<InvalidDataException>(() => MetadataReader.Inspect("large", large));
        var path = Path.Combine(directory, "large.trayitem");
        File.WriteAllBytes(path, large);
        Assert.Throws<InvalidDataException>(() => InputReader.Read(path).ToArray());
        path = Path.Combine(directory, "large.zip");
        File.WriteAllBytes(path, Zip(("large.trayitem", large)));
        Assert.Throws<InvalidDataException>(() => InputReader.Read(path).ToArray());
        using (var stream = File.Create(path)) stream.SetLength(32 * 1024 * 1024 + 1);
        Assert.Throws<InvalidDataException>(() => InputReader.Read(path).ToArray());
    }

    [Fact]
    public void EmptyDirectoryDoesNotManufactureAResult() => Assert.Empty(InputReader.Read(directory));
}
