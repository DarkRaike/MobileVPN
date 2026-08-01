import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = join(import.meta.dirname, "..", "..");
const DOCUMENTATION_DIRECTORY = join(REPOSITORY_ROOT, "docs", "operations");

function read(...segments: string[]): string {
  return readFileSync(join(REPOSITORY_ROOT, ...segments), "utf8");
}

/** Scripts the production stage copies out of the build stage. */
function copiedScripts(dockerfile: string): Set<string> {
  const productionStage = dockerfile.slice(dockerfile.indexOf("AS production"));
  const stage = productionStage.slice(
    0,
    productionStage.indexOf("\nFROM ") === -1
      ? undefined
      : productionStage.indexOf("\nFROM "),
  );

  return new Set(
    captureAll(stage, /COPY[^\n]*\s(\S*scripts\/[\w-]+\.mjs)\s*$/gmu).map(
      (destination) => destination.replace(/^.*scripts\//u, "scripts/"),
    ),
  );
}

/** First capture group of every match, with the unmatched case removed. */
function captureAll(content: string, pattern: RegExp): string[] {
  return [...content.matchAll(pattern)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
}

function documentedScripts(): Map<string, string> {
  const referenced = new Map<string, string>();

  for (const name of readdirSync(DOCUMENTATION_DIRECTORY)) {
    if (!name.endsWith(".md")) {
      continue;
    }

    const content = readFileSync(join(DOCUMENTATION_DIRECTORY, name), "utf8");

    for (const script of captureAll(
      content,
      /exec[^\n]*\bapp\b[^\n]*\bnode\s+(scripts\/[\w-]+\.mjs)/gu,
    )) {
      referenced.set(script, name);
    }
  }

  return referenced;
}

function composeScripts(compose: string): Set<string> {
  return new Set(captureAll(compose, /-\s+(scripts\/[\w-]+\.mjs)/gu));
}

describe("production image", () => {
  const dockerfile = read("Dockerfile");
  const copied = copiedScripts(dockerfile);

  it("copies every script the operations documentation runs inside it", () => {
    // A documented command that references a missing script fails with a module
    // resolution error at the exact moment the operator needs a diagnosis.
    for (const [script, document] of documentedScripts()) {
      expect(copied, `${script} is documented in ${document}`).toContain(
        script,
      );
    }
  });

  it("copies every script a production service is started with", () => {
    for (const script of composeScripts(
      read("deployment", "compose.production.yaml"),
    )) {
      expect(copied).toContain(script);
    }
  });
});
