using System.IO.Compression;

namespace Sims4Spike;

// Research-only reader: no extraction and no blueprint/resource dependency resolution.
public static class InputReader
{
    const int MetadataLimit = 4 * 1024 * 1024;
    const int ArchiveLimit = 32 * 1024 * 1024;
    const int EntryLimit = 10_000;

    public static IEnumerable<MetadataResult> Read(string input)
    {
        input = Path.GetFullPath(input);
        var isDirectory = Directory.Exists(input);
        var paths = isDirectory
            ? Directory.EnumerateFiles(input, "*", new EnumerationOptions {
                RecurseSubdirectories = true, AttributesToSkip = FileAttributes.ReparsePoint,
                IgnoreInaccessible = false
              }).Order().ToArray()
            : [input];
        foreach (var path in paths)
        {
            var source = (isDirectory ? Path.GetRelativePath(input, path) : Path.GetFileName(path)).Replace('\\', '/');
            if (IsMacSidecar(source)) continue;
            if (path.EndsWith(".trayitem", StringComparison.OrdinalIgnoreCase))
            {
                using var stream = File.OpenRead(path);
                yield return MetadataReader.Inspect(source, ReadBounded(stream, MetadataLimit));
            }
            else if (path.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            {
                using var stream = File.OpenRead(path);
                if (stream.Length > ArchiveLimit) throw new InvalidDataException("Archive exceeds spike limit.");
                foreach (var result in ReadArchive(stream, source, 0, new Budget())) yield return result;
            }
        }
    }

    sealed class Budget { public int Entries; public long Bytes; }

    static IEnumerable<MetadataResult> ReadArchive(Stream stream, string source, int depth, Budget budget)
    {
        if (depth > 1) throw new InvalidDataException("Only one nested ZIP level is supported by the spike.");
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
        foreach (var entry in archive.Entries)
        {
            if (++budget.Entries > EntryLimit) throw new InvalidDataException("Too many archive entries.");
            if (IsMacSidecar(entry.FullName)) continue;
            var isTray = entry.FullName.EndsWith(".trayitem", StringComparison.OrdinalIgnoreCase);
            var isZip = entry.FullName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
            if (!isTray && !isZip) continue;
            var limit = isTray ? MetadataLimit : ArchiveLimit;
            if (entry.Length > limit) throw new InvalidDataException("Archive entry exceeds spike limit.");
            using var entryStream = entry.Open();
            var bytes = ReadBounded(entryStream, limit);
            budget.Bytes += bytes.Length;
            if (budget.Bytes > ArchiveLimit) throw new InvalidDataException("Total expanded metadata exceeds spike limit.");
            var entrySource = source + "!" + entry.FullName;
            if (isTray) yield return MetadataReader.Inspect(entrySource, bytes);
            else
            {
                using var nested = new MemoryStream(bytes);
                foreach (var result in ReadArchive(nested, entrySource, depth + 1, budget)) yield return result;
            }
        }
    }

    static bool IsMacSidecar(string path) => path.Replace('\\', '/').Split('/')
        .Any(part => part == "__MACOSX" || part.StartsWith("._", StringComparison.Ordinal));

    static byte[] ReadBounded(Stream stream, int limit)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int count;
        while ((count = stream.Read(chunk)) > 0)
        {
            if (buffer.Length + count > limit) throw new InvalidDataException("Input exceeds spike limit.");
            buffer.Write(chunk, 0, count);
        }
        return buffer.ToArray();
    }
}
