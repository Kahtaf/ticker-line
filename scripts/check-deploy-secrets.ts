/**
 * Deploy guard for Worker secrets.
 *
 * Reads `.env`, allows only the provider API keys, rejects empty values, and
 * runs `wrangler deploy` with a temporary secrets file that holds nothing but
 * the validated keys. Secret values are never printed.
 *
 * Usage: node --experimental-strip-types scripts/check-deploy-secrets.ts [wrangler deploy args...]
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

/** Must match PROVIDER_API_KEY_BINDINGS in src/providers/registry.ts. */
export const ALLOWED_DEPLOY_SECRETS: readonly string[] = [
  "LSE_API_KEY",
  "SIFTING_API_KEY",
];

export class DeploySecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploySecretsError";
  }
}

export type DeploySecretsPlan = Readonly<{
  /** Secrets to upload with this deploy. */
  secrets: Readonly<Record<string, string>>;
  /** Names uploaded with this deploy. */
  uploaded: readonly string[];
  /** Allowed names absent from the file; their deployed values are kept. */
  kept: readonly string[];
}>;

export function selectDeploySecrets(content: string): DeploySecretsPlan {
  const parsed = parseEnv(content);
  const names = Object.keys(parsed).sort();
  const disallowed = names.filter(
    (name) => !ALLOWED_DEPLOY_SECRETS.includes(name),
  );
  if (disallowed.length > 0) {
    throw new DeploySecretsError(
      `.env contains keys that must not be uploaded as Worker secrets: ${disallowed.join(", ")}. ` +
        `Only ${ALLOWED_DEPLOY_SECRETS.join(", ")} are allowed; remove or comment out the others.`,
    );
  }
  const empty = names.filter((name) => (parsed[name] ?? "").trim() === "");
  if (empty.length > 0) {
    throw new DeploySecretsError(
      `.env has empty values for: ${empty.join(", ")}. Uploading them would overwrite the deployed secrets; ` +
        `set a value or comment the line out (e.g. "# ${empty[0]}=") to keep the deployed value.`,
    );
  }
  const secrets: Record<string, string> = {};
  for (const name of names) secrets[name] = parsed[name] ?? "";
  return {
    secrets,
    uploaded: names,
    kept: ALLOWED_DEPLOY_SECRETS.filter((name) => !names.includes(name)).sort(),
  };
}

export function readDeploySecrets(path: string): DeploySecretsPlan {
  if (!existsSync(path)) {
    throw new DeploySecretsError(
      `${path} not found. Copy .env.example to .env and set the provider keys to upload.`,
    );
  }
  return selectDeploySecrets(readFileSync(path, "utf8"));
}

/** Write the secrets as JSON to a file readable only by the current user. */
export function writeSecretsFile(
  dir: string,
  secrets: Readonly<Record<string, string>>,
): string {
  const path = join(dir, "secrets.json");
  writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 });
  return path;
}

/** Absolute path to the project's Wrangler CLI, so no PATH lookup is needed. */
function wranglerBin(): string {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("wrangler/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    bin: Record<string, string>;
  };
  const bin = manifest.bin["wrangler"];
  if (bin === undefined) throw new Error("wrangler bin entry not found.");
  return join(dirname(manifestPath), bin);
}

function main(args: readonly string[]): number {
  let plan: DeploySecretsPlan;
  try {
    plan = readDeploySecrets(resolve(".env"));
  } catch (error) {
    if (error instanceof DeploySecretsError) {
      console.error(`Deploy aborted: ${error.message}`);
      return 1;
    }
    throw error;
  }
  console.log(
    `Secrets to upload: ${plan.uploaded.join(", ") || "(none)"}. ` +
      `Keeping deployed values for: ${plan.kept.join(", ") || "(none)"}.`,
  );

  const dir = mkdtempSync(join(tmpdir(), "ticker-line-secrets-"));
  try {
    const secretsArgs =
      plan.uploaded.length === 0
        ? []
        : ["--secrets-file", writeSecretsFile(dir, plan.secrets)];
    const result = spawnSync(
      process.execPath,
      [wranglerBin(), "deploy", ...args, ...secretsArgs],
      { stdio: "inherit" },
    );
    if (result.error !== undefined) throw result.error;
    return result.status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = main(process.argv.slice(2));
}
