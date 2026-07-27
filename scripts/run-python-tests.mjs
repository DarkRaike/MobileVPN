import { spawnSync } from "node:child_process";

const candidates =
  process.platform === "win32" ? ["python", "py"] : ["python3", "python"];

for (const executable of candidates) {
  const result = spawnSync(
    executable,
    ["-m", "unittest", "discover", "-s", "tests/operations", "-v"],
    {
      encoding: "utf8",
      stdio: "inherit",
    },
  );

  if (result.error?.code === "ENOENT") {
    continue;
  }

  process.exit(result.status ?? 1);
}

console.error("Python 3 is required to run operational tests.");
process.exit(1);
