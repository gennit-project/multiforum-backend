using System.Runtime.InteropServices;
using System.Text.Json;
using Sims4Spike;

if (args.Length != 1)
{
    Console.Error.WriteLine("Usage: Probe <trayitem, zip, or directory>");
    return 2;
}
try
{
    var results = InputReader.Read(args[0]).ToArray();
    if (results.Length == 0) throw new InvalidDataException("No supported tray files found.");
    Console.WriteLine(JsonSerializer.Serialize(new {
        runtime = RuntimeInformation.FrameworkDescription,
        os = RuntimeInformation.OSDescription,
        architecture = RuntimeInformation.ProcessArchitecture.ToString(),
        protobufVersion = typeof(EA.Sims4.Network.TrayMetadata).Assembly.GetName().Version?.ToString(),
        results
    }, new JsonSerializerOptions { WriteIndented = true }));
    return 0;
}
catch (Exception error) when (error is IOException or InvalidDataException or ProtoBuf.ProtoException or UnauthorizedAccessException)
{
    Console.Error.WriteLine(error.Message);
    return 1;
}
