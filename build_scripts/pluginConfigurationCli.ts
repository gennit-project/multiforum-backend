import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Manifest = {
  apiVersion: string;
  plugins: Array<{
    pluginId: string;
    version: string;
    enabled: boolean;
    secretRefs?: Array<{ key: string; valueFrom: string }>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};
type Plan = {
  apiVersion: string;
  inSync: boolean;
  warnings: string[];
  changes: Array<{ kind: string; path: string; message: string; blocked: boolean }>;
};
type ApplyResult = {
  status: string;
  message: string;
  operations: Array<{ kind: string; path: string; status: string; message: string }>;
  planAfter: Plan;
};
type Dependencies = {
  env: NodeJS.ProcessEnv;
  fetch: typeof globalThis.fetch;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
};

export const EXIT = { SUCCESS: 0, ERROR: 1, DRIFT: 2 } as const;

const PREVIEW =
  "query MfctlPreview($manifest: PluginConfigurationDesiredStateInput!) {" +
  " previewPluginConfigurationReconciliation(manifest: $manifest) {" +
  " apiVersion inSync warnings changes { kind path message blocked } } }";
const APPLY =
  "mutation MfctlApply($manifest: PluginConfigurationDesiredStateInput!," +
  " $secretResolutions: [PluginSecretResolutionInput!]!) {" +
  " applyPluginConfiguration(manifest: $manifest, secretResolutions: $secretResolutions) {" +
  " status message operations { kind path status message }" +
  " planAfter { apiVersion inSync warnings changes { kind path message blocked } } } }";
const USAGE =
  "Usage:\n" +
  "  pnpm mfctl plugin-config plan --manifest <file> [--endpoint <url>] [--json]\n" +
  "  pnpm mfctl plugin-config apply --manifest <file> [--endpoint <url>] [--json]\n\n" +
  "Environment:\n" +
  "  MULTIFORUM_GRAPHQL_URL   GraphQL endpoint (unless --endpoint is supplied)\n" +
  "  MULTIFORUM_ACCESS_TOKEN Bearer token for a user with canManagePlugins\n\n" +
  "Exit codes: 0 success/in sync, 1 error or failed apply, 2 plan found drift.\n";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseManifest = (text: string): Manifest => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Manifest must be valid JSON.");
  }
  if (!isRecord(value) || typeof value.apiVersion !== "string") {
    throw new Error("Manifest must contain a string apiVersion.");
  }
  if (!Array.isArray(value.plugins)) {
    throw new Error("Manifest must contain a plugins array.");
  }
  for (const [index, plugin] of value.plugins.entries()) {
    if (
      !isRecord(plugin) ||
      typeof plugin.pluginId !== "string" ||
      typeof plugin.version !== "string" ||
      typeof plugin.enabled !== "boolean"
    ) {
      throw new Error(
        "Manifest plugin at index " + index +
          " requires pluginId, version, and enabled."
      );
    }
  }
  return value as Manifest;
};

export const resolveManifestSecrets = (
  manifest: Manifest,
  env: NodeJS.ProcessEnv
): Array<{ valueFrom: string; value: string }> => {
  const references = new Set(
    manifest.plugins.flatMap(plugin =>
      (plugin.secretRefs ?? []).map(secret => secret.valueFrom)
    )
  );
  return [...references].map(valueFrom => {
    if (!valueFrom.startsWith("env:") || valueFrom.length === 4) {
      throw new Error(
        "Unsupported secret reference '" + valueFrom +
          "'. mfctl supports env:NAME references."
      );
    }
    const name = valueFrom.slice(4);
    const value = env[name];
    if (!value) {
      throw new Error(
        "Environment variable " + name + " is required by " + valueFrom + "."
      );
    }
    return { valueFrom, value };
  });
};

const parseArguments = (args: string[]) => {
  const action = args[1];
  if (args[0] !== "plugin-config" || (action !== "plan" && action !== "apply")) {
    throw new Error(USAGE);
  }
  let manifestPath: string | undefined;
  let endpoint: string | undefined;
  let json = false;
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") json = true;
    else if (argument === "--manifest") manifestPath = args[++index];
    else if (argument === "--endpoint") endpoint = args[++index];
    else throw new Error("Unknown argument: " + argument + "\n\n" + USAGE);
  }
  if (!manifestPath) throw new Error("--manifest is required.\n\n" + USAGE);
  return { action, manifestPath, endpoint, json };
};

const request = async <T>(
  endpoint: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImplementation: typeof globalThis.fetch
): Promise<T> => {
  let response: Response;
  try {
    response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error: unknown) {
    throw new Error(
      "Could not reach Multiforum: " +
        (error instanceof Error ? error.message : "network error")
    );
  }
  if (!response.ok) {
    throw new Error("Multiforum returned HTTP " + response.status + ".");
  }
  let payload: { data?: T; errors?: Array<{ message?: unknown }> };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new Error("Multiforum returned an invalid JSON response.");
  }
  if (payload.errors?.length) {
    throw new Error(
      payload.errors
        .map(error =>
          typeof error.message === "string" ? error.message : "GraphQL request failed"
        )
        .join("; ")
    );
  }
  if (!payload.data) throw new Error("Multiforum response did not contain data.");
  return payload.data;
};

const formatPlan = (plan: Plan): string => {
  const lines = [
    plan.inSync
      ? "Plugin configuration is in sync."
      : "Plugin configuration drift detected.",
    ...plan.warnings.map(warning => "warning: " + warning),
    ...plan.changes.map(
      change =>
        (change.blocked ? "BLOCKED" : change.kind) +
        " " + change.path + ": " + change.message
    ),
  ];
  return lines.join("\n") + "\n";
};

const formatApply = (result: ApplyResult): string => {
  const lines = [
    result.status + ": " + result.message,
    ...result.operations.map(
      operation =>
        operation.status + " " + operation.kind + " " + operation.path +
        ": " + operation.message
    ),
  ];
  if (!result.planAfter.inSync) lines.push(formatPlan(result.planAfter).trimEnd());
  return lines.join("\n") + "\n";
};

export const runPluginConfigurationCli = async (
  args: string[],
  dependencies: Dependencies = {
    env: process.env,
    fetch: globalThis.fetch,
    readFile,
    stdout: process.stdout,
    stderr: process.stderr,
  }
): Promise<number> => {
  try {
    const parsed = parseArguments(args);
    const endpoint = parsed.endpoint ?? dependencies.env.MULTIFORUM_GRAPHQL_URL;
    const token = dependencies.env.MULTIFORUM_ACCESS_TOKEN;
    if (!endpoint) {
      throw new Error("MULTIFORUM_GRAPHQL_URL or --endpoint is required.");
    }
    if (!token) throw new Error("MULTIFORUM_ACCESS_TOKEN is required.");
    const manifest = parseManifest(
      await dependencies.readFile(resolve(parsed.manifestPath), "utf8")
    );

    if (parsed.action === "plan") {
      const data = await request<{ previewPluginConfigurationReconciliation: Plan }>(
        endpoint,
        token,
        PREVIEW,
        { manifest },
        dependencies.fetch
      );
      const plan = data.previewPluginConfigurationReconciliation;
      dependencies.stdout.write(
        parsed.json ? JSON.stringify(plan, null, 2) + "\n" : formatPlan(plan)
      );
      return plan.inSync ? EXIT.SUCCESS : EXIT.DRIFT;
    }

    const data = await request<{ applyPluginConfiguration: ApplyResult }>(
      endpoint,
      token,
      APPLY,
      {
        manifest,
        secretResolutions: resolveManifestSecrets(manifest, dependencies.env),
      },
      dependencies.fetch
    );
    const result = data.applyPluginConfiguration;
    dependencies.stdout.write(
      parsed.json ? JSON.stringify(result, null, 2) + "\n" : formatApply(result)
    );
    return ["APPLIED", "NO_CHANGES"].includes(result.status) &&
      result.planAfter.inSync
      ? EXIT.SUCCESS
      : EXIT.ERROR;
  } catch (error: unknown) {
    dependencies.stderr.write(
      (error instanceof Error ? error.message : "mfctl failed") + "\n"
    );
    return EXIT.ERROR;
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runPluginConfigurationCli(process.argv.slice(2));
}
