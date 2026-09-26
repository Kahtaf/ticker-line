import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALLOWED_DEPLOY_SECRETS,
  DeploySecretsError,
  readDeploySecrets,
  selectDeploySecrets,
  writeSecretsFile,
} from "../../scripts/check-deploy-secrets";
import { PROVIDER_API_KEY_BINDINGS } from "../../src/providers/registry";

describe("selectDeploySecrets", () => {
  it("allows exactly the provider key bindings", () => {
    expect([...ALLOWED_DEPLOY_SECRETS].sort()).toEqual(
      Object.values(PROVIDER_API_KEY_BINDINGS).sort(),
    );
  });

  it("uploads allowed keys and reports the others as kept", () => {
    const plan = selectDeploySecrets("LSE_API_KEY=lse-value\n");
    expect(plan.secrets).toEqual({ LSE_API_KEY: "lse-value" });
    expect(plan.uploaded).toEqual(["LSE_API_KEY"]);
    expect(plan.kept).toEqual(["SIFTING_API_KEY"]);
  });

  it("uploads both keys when both are set", () => {
    const plan = selectDeploySecrets(
      "SIFTING_API_KEY=sifting-value\nLSE_API_KEY=lse-value\n",
    );
    expect(plan.secrets).toEqual({
      SIFTING_API_KEY: "sifting-value",
      LSE_API_KEY: "lse-value",
    });
    expect(plan.uploaded).toEqual(["LSE_API_KEY", "SIFTING_API_KEY"]);
    expect(plan.kept).toEqual([]);
  });

  it("ignores comments and blank lines, trims whitespace, and strips quotes", () => {
    const plan = selectDeploySecrets(
      [
        "# Provider keys",
        "# SIFTING_API_KEY=",
        "",
        '   LSE_API_KEY =   "quoted value"   ',
        "",
      ].join("\n"),
    );
    expect(plan.secrets).toEqual({ LSE_API_KEY: "quoted value" });
    expect(plan.kept).toEqual(["SIFTING_API_KEY"]);
  });

  it("accepts single-quoted values", () => {
    expect(selectDeploySecrets("LSE_API_KEY='abc'\n").secrets).toEqual({
      LSE_API_KEY: "abc",
    });
  });

  it("uploads nothing when every key is commented out", () => {
    const plan = selectDeploySecrets("# LSE_API_KEY=\n# SIFTING_API_KEY=\n");
    expect(plan.secrets).toEqual({});
    expect(plan.uploaded).toEqual([]);
    expect(plan.kept).toEqual(["LSE_API_KEY", "SIFTING_API_KEY"]);
  });

  it.each(["LSE_API_KEY=\n", 'LSE_API_KEY=""\n', "LSE_API_KEY=   \n"])(
    "rejects an empty value in %j",
    (content) => {
      expect(() => selectDeploySecrets(content)).toThrow(DeploySecretsError);
      expect(() => selectDeploySecrets(content)).toThrow(/LSE_API_KEY/);
    },
  );

  it("rejects a key that is not a provider secret, naming only the key", () => {
    const content =
      "LSE_API_KEY=lse-value\nCLOUDFLARE_API_TOKEN=super-secret-token\n";
    expect(() => selectDeploySecrets(content)).toThrow(DeploySecretsError);
    try {
      selectDeploySecrets(content);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("CLOUDFLARE_API_TOKEN");
      expect(message).not.toContain("super-secret-token");
      expect(message).not.toContain("lse-value");
    }
  });
});

describe("readDeploySecrets and writeSecretsFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "deploy-secrets-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails clearly when the file is missing", () => {
    expect(() => readDeploySecrets(join(dir, ".env"))).toThrow(
      DeploySecretsError,
    );
    expect(() => readDeploySecrets(join(dir, ".env"))).toThrow(/\.env/);
  });

  it("reads a file from disk", () => {
    const path = join(dir, ".env");
    writeFileSync(path, "LSE_API_KEY=lse-value\n");
    expect(readDeploySecrets(path).uploaded).toEqual(["LSE_API_KEY"]);
  });

  it("writes only the selected secrets to a private JSON file", () => {
    const path = writeSecretsFile(dir, { LSE_API_KEY: "lse-value" });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      LSE_API_KEY: "lse-value",
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
